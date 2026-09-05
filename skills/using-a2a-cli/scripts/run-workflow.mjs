#!/usr/bin/env node
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const TERMINAL_STATES = new Set([
  "completed",
  "failed",
  "canceled",
  "rejected",
  "input-required",
  "auth-required",
]);
const NONTERMINAL_STATES = new Set(["submitted", "working"]);

/** @typedef {(args: string[]) => Promise<unknown>} CommandRunner */

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`malformed ${label}`);
  }
  return value;
}

function optionalString(value, field) {
  if (value[field] === undefined) return undefined;
  if (typeof value[field] !== "string") throw new Error(`malformed ${field}`);
  return value[field];
}

function partKind(part) {
  if (part === null || typeof part !== "object" || Array.isArray(part))
    return "unknown";
  if ("file" in part) return "file";
  if ("data" in part) return "data";
  return typeof part.kind === "string" ? part.kind : "unknown";
}

function extractParts(parts, prefix) {
  if (parts === undefined) return { text: "", nonTextParts: [] };
  if (!Array.isArray(parts)) throw new Error(`malformed ${prefix}`);
  let text = "";
  const nonTextParts = [];
  parts.forEach((part, index) => {
    if (
      part !== null &&
      typeof part === "object" &&
      !Array.isArray(part) &&
      typeof part.text === "string"
    ) {
      text += part.text;
    } else {
      nonTextParts.push({
        location: `${prefix}[${index}]`,
        kind: partKind(part),
      });
    }
  });
  return { text, nonTextParts };
}

function envelopeKind(value) {
  if (value.kind === "message" || value.kind === "task") return value.kind;
  if (value.type === "message" || value.type === "task") return value.type;
  if (typeof value.messageId === "string" && Array.isArray(value.parts))
    return "message";
  if (
    typeof value.id === "string" &&
    value.status &&
    typeof value.status === "object"
  )
    return "task";
  throw new Error(
    `unknown A2A envelope kind: ${String(value.kind ?? value.type)}`,
  );
}

function unwrapSendResponse(response) {
  const value = record(response, "send response");
  const hasMessage = Object.hasOwn(value, "message");
  const hasTask = Object.hasOwn(value, "task");
  if (hasMessage === hasTask) {
    // Retain compatibility with fixtures and servers that return the inner value directly.
    envelopeKind(value);
    return value;
  }
  return record(
    hasMessage ? value.message : value.task,
    "send response envelope",
  );
}

function normalizeTaskState(value) {
  if (typeof value !== "string") throw new Error("malformed task state");
  const normalized = value
    .replace(/^TASK_STATE_/, "")
    .toLowerCase()
    .replaceAll("_", "-");
  if (!TERMINAL_STATES.has(normalized) && !NONTERMINAL_STATES.has(normalized)) {
    throw new Error(`unknown task state: ${value}`);
  }
  return normalized;
}

function taskState(task) {
  const status = record(task.status, "task status");
  return normalizeTaskState(status.state);
}

function identifiers(value) {
  const contextId = optionalString(value, "contextId");
  const result = {};
  if (contextId !== undefined) result.contextId = contextId;
  return result;
}

/** Convert a direct-message or terminal-task envelope to a deterministic local result. */
export function extractResult(envelope) {
  const value = record(envelope, "A2A envelope");
  const kind = envelopeKind(value);
  if (kind === "message") {
    const extracted = extractParts(value.parts, "message.parts");
    const result = {
      outcome: "message",
      state: "completed",
      ...identifiers(value),
    };
    if (result.contextId === undefined) result.continuationUnavailable = true;
    if (extracted.text.length > 0) result.text = extracted.text;
    else result.missingText = true;
    if (extracted.nonTextParts.length > 0)
      result.nonTextParts = extracted.nonTextParts;
    return result;
  }

  const state = taskState(value);
  if (!TERMINAL_STATES.has(state))
    throw new Error(`task is not terminal: ${state}`);
  if (typeof value.id !== "string" || value.id.length === 0)
    throw new Error("malformed task id");
  const result = {
    outcome: "task",
    state,
    taskId: value.id,
    ...identifiers(value),
  };
  if (result.contextId === undefined) result.continuationUnavailable = true;
  if (state !== "completed") return result;

  if (value.artifacts !== undefined && !Array.isArray(value.artifacts)) {
    throw new Error("malformed task artifacts");
  }
  const artifactTexts = [];
  const nonTextParts = [];
  let hasText = false;
  for (const [artifactIndex, artifactValue] of (
    value.artifacts ?? []
  ).entries()) {
    const artifact = record(artifactValue, `artifacts[${artifactIndex}]`);
    const extracted = extractParts(
      artifact.parts,
      `artifacts[${artifactIndex}].parts`,
    );
    artifactTexts.push(extracted.text);
    if (extracted.text.length > 0) hasText = true;
    nonTextParts.push(...extracted.nonTextParts);
  }
  if (hasText) result.text = artifactTexts.join("\n");
  else result.missingText = true;
  if (nonTextParts.length > 0) result.nonTextParts = nonTextParts;
  return result;
}

export function validateAgentCard(
  card,
  { expectedGatewayUrl, expectedTokenUrl } = {},
) {
  const value = record(card, "Agent Card");
  const interfaces = value.supportedInterfaces;
  if (!Array.isArray(interfaces))
    throw new Error("Agent Card has no supported interfaces");
  const expectedGateway = normalizeExpectedUrl(expectedGatewayUrl, "gateway");
  const hasExpectedInterface = interfaces.some((candidate) => {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    )
      return false;
    if (
      String(candidate.protocolBinding).toUpperCase() !== "JSONRPC" ||
      candidate.protocolVersion !== "1.0"
    )
      return false;
    try {
      return normalizeUrl(candidate.url) === expectedGateway;
    } catch {
      return false;
    }
  });
  if (!hasExpectedInterface)
    throw new Error(
      "Agent Card lacks the configured A2A 1.0 JSON-RPC interface",
    );

  const oauth = value.securitySchemes?.a2aOAuth?.oauth2SecurityScheme;
  const clientCredentials = oauth?.flows?.clientCredentials;
  if (clientCredentials === null || typeof clientCredentials !== "object") {
    throw new Error("Agent Card lacks OAuth client credentials");
  }
  const expectedToken = normalizeExpectedUrl(expectedTokenUrl, "token");
  if (normalizeUrl(clientCredentials.tokenUrl) !== expectedToken) {
    throw new Error("Agent Card advertises an unexpected OAuth token URL");
  }
  const scopes = clientCredentials.scopes;
  if (
    scopes === null ||
    typeof scopes !== "object" ||
    !("a2a.discover" in scopes) ||
    !("a2a.invoke" in scopes)
  ) {
    throw new Error("Agent Card lacks the required OAuth scopes");
  }
  const requiresInvoke =
    Array.isArray(value.securityRequirements) &&
    value.securityRequirements.some(
      (requirement) =>
        requirement?.schemes?.a2aOAuth?.list?.includes?.("a2a.invoke") ||
        requirement?.a2aOAuth?.includes?.("a2a.invoke"),
    );
  if (!requiresInvoke)
    throw new Error("Agent Card does not require a2a.invoke");

  const defaultInput = Array.isArray(value.defaultInputModes)
    ? value.defaultInputModes
    : [];
  const defaultOutput = Array.isArray(value.defaultOutputModes)
    ? value.defaultOutputModes
    : [];
  const hasTextSkill =
    Array.isArray(value.skills) &&
    value.skills.some((skill) => {
      const inputs = Array.isArray(skill?.inputModes)
        ? skill.inputModes
        : defaultInput;
      const outputs = Array.isArray(skill?.outputModes)
        ? skill.outputModes
        : defaultOutput;
      return inputs.includes("text/plain") && outputs.includes("text/plain");
    });
  if (!hasTextSkill) throw new Error("Agent Card has no compatible text skill");
  return value;
}

/** Run exactly one card/send/poll workflow through an injected trusted launcher. */
export async function runWorkflow({
  text,
  contextId,
  runner = launcherRunner(),
  expectedGatewayUrl = process.env.A2A_CLI_GATEWAY_URL,
  expectedTokenUrl = process.env.A2A_CLI_TOKEN_URL,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  clock = () => Date.now(),
  timeoutMs = 120_000,
}) {
  if (typeof text !== "string" || text.length === 0)
    throw new Error("text must be a non-empty string");
  if (contextId !== undefined && typeof contextId !== "string")
    throw new Error("contextId must be a string");

  // Card fields are validated as data; its prose is never interpreted as instructions.
  validateAgentCard(await runner(["card"]), {
    expectedGatewayUrl,
    expectedTokenUrl,
  });
  const sendArgs = ["send", "--text", text, "--return-immediately"];
  if (contextId !== undefined) sendArgs.push("--context-id", contextId);
  let envelope = unwrapSendResponse(await runner(sendArgs));
  if (envelopeKind(envelope) === "message") return extractResult(envelope);

  let state = taskState(envelope);
  if (TERMINAL_STATES.has(state)) return extractResult(envelope);
  if (typeof envelope.id !== "string" || envelope.id.length === 0)
    throw new Error("malformed task id");
  const taskId = envelope.id;
  const retainedContextId = optionalString(envelope, "contextId");
  const startedAt = clock();

  while (clock() - startedAt < timeoutMs) {
    await sleep(1_000);
    if (clock() - startedAt >= timeoutMs) break;
    envelope = record(
      await runner(["get-task", "--task-id", taskId]),
      "A2A envelope",
    );
    if (envelopeKind(envelope) !== "task")
      throw new Error("get-task returned a non-task envelope");
    if (envelope.id !== taskId)
      throw new Error("get-task returned a different task id");
    state = taskState(envelope);
    if (TERMINAL_STATES.has(state)) {
      const result = extractResult(envelope);
      if (result.contextId === undefined && retainedContextId !== undefined) {
        result.contextId = retainedContextId;
        delete result.continuationUnavailable;
      }
      return result;
    }
  }

  let cancelSucceeded = true;
  try {
    await runner(["cancel-task", "--task-id", taskId]);
  } catch {
    cancelSucceeded = false;
  }
  const result = {
    outcome: "task",
    state: "timeout",
    taskId,
    cancelAttempted: true,
    cancelSucceeded,
  };
  if (retainedContextId !== undefined) result.contextId = retainedContextId;
  else result.continuationUnavailable = true;
  return result;
}

function normalizeExpectedUrl(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`A2A_CLI_${label.toUpperCase()}_URL is required`);
  }
  return normalizeUrl(value);
}

function normalizeUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href;
}

export function launcherRunner(
  launcher = process.env.A2A_CLI_LAUNCHER,
  {
    timeoutMs = 45_000,
    stdoutLimit = 1024 * 1024,
    stderrLimit = 64 * 1024,
  } = {},
) {
  if (typeof launcher !== "string" || launcher.length === 0) {
    throw new Error(
      "A2A_CLI_LAUNCHER must name the trusted repository launcher",
    );
  }
  return (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [launcher, ...args], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let failed = false;
      const terminate = () => {
        failed = true;
        try {
          child.kill("SIGTERM");
        } catch {}
      };
      child.stdout.setEncoding("utf8").on("data", (chunk) => {
        stdoutBytes += Buffer.byteLength(chunk);
        if (stdoutBytes > stdoutLimit) terminate();
        else stdout.push(chunk);
      });
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrBytes > stderrLimit) terminate();
      });
      child.on("error", () => {
        failed = true;
      });
      const timer = setTimeout(terminate, timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failed || code !== 0)
          return reject(new Error("A2A launcher failed"));
        try {
          resolve(JSON.parse(stdout.join("")));
        } catch {
          reject(new Error("A2A launcher returned malformed JSON"));
        }
      });
    });
}

async function main(argv) {
  let text;
  let contextId;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--text" && argv[index + 1] !== undefined)
      text = argv[++index];
    else if (argv[index] === "--context-id" && argv[index + 1] !== undefined)
      contextId = argv[++index];
    else
      throw new Error(
        "usage: run-workflow.mjs --text <text> [--context-id <id>]",
      );
  }
  const result = await runWorkflow({ text, contextId });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
