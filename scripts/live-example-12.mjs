#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERMES_IMAGE =
  "docker.io/nousresearch/hermes-agent:v2026.8.31@sha256:64923faeae267792bf9bf87fe3b4c4869e35004e360c7df01730ad801b74d524";
const project = `letta-a2a-example-12-live-${process.pid}-${randomUUID().slice(0, 8)}`;
const clientSecret = `hermes-live-${randomUUID()}-${randomUUID()}`;
const gatewayPort = await findFreePort();
const gatewayUiPort = await findFreePort();
const oauthPort = await findFreePort();
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required for the live Example 12 proof.");
  process.exit(2);
}
const providerSecretDirectory = mkdtempSync(
  join(tmpdir(), "letta-a2a-example-12-live-"),
);
const providerSecretPath = join(providerSecretDirectory, "openai-api-key");
writeFileSync(providerSecretPath, process.env.OPENAI_API_KEY, { mode: 0o600 });
const composeEnv = {
  ...process.env,
  A2A_GATEWAY_PORT: gatewayPort,
  A2A_GATEWAY_UI_PORT: gatewayUiPort,
  OAUTH_PORT: oauthPort,
  OAUTH_HERMES_CLIENT_ID: "hermes-live-client",
  HERMES_OAUTH_CLIENT_SECRET: clientSecret,
  OAUTH_HERMES_TOKEN_TTL_SECONDS: "900",
  OPENAI_API_KEY_SECRET_FILE: providerSecretPath,
  HERMES_MODEL: process.env.HERMES_MODEL ?? "gpt-5-mini",
  ADK_MODEL: process.env.ADK_MODEL ?? "openai/gpt-4.1-nano",
  ADK_MODEL_MODE: "live",
};

let failure;
try {
  compose([
    "--profile",
    "example-12-live",
    "up",
    "--build",
    "--detach",
    "--wait",
    "--wait-timeout",
    "240",
    "google-adk-agent",
    "agentgateway",
  ]);

  runHermes(
    "Use the a2a_call tool exactly once with agent google-adk and message: " +
      "Remember the codeword LANTERN and reply STORED. Return only the remote " +
      "reply and its context ID.",
  );
  const contextId = readHermesContextId();

  const second = runHermes(
    `Use the a2a_call tool exactly once with agent google-adk, context_id ${contextId}, ` +
      "and message: What codeword did I ask you to remember? Return only the " +
      "remote reply and its context ID.",
  );
  assert(
    second.includes("LANTERN"),
    `Hermes did not recover the codeword:\n${second}`,
  );
  assert(
    readHermesContextId() === contextId,
    "Hermes created a second context instead of continuing the first",
  );

  const audit = dockerCapture([
    "run",
    "--rm",
    "--entrypoint",
    "/bin/cat",
    "-v",
    `${project}_hermes-state:/opt/data:ro`,
    HERMES_IMAGE,
    "/opt/data/a2a_audit.jsonl",
  ]);
  assert(audit.status === 0, "could not read Hermes A2A audit evidence");
  const records = audit.output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert(
    records.length === 2,
    `expected two Hermes A2A audit records, got ${records.length}`,
  );
  assert(
    records.every((record) => record.peer === "google-adk"),
    "Hermes called an unexpected peer",
  );
  assert(
    records[0].summary === "Remember the codeword LANTERN and reply STORED." &&
      records[1].summary === "What codeword did I ask you to remember?",
    "Hermes audit did not retain the two expected A2A calls",
  );

  const logs = composeCapture([
    "--profile",
    "example-12-live",
    "logs",
    "--no-color",
    "auth-server",
    "agentgateway",
    "google-adk-agent",
  ]);
  assert(logs.status === 0, "could not inspect live Example 12 logs");
  assert(
    !logs.output.includes(clientSecret),
    "Hermes client secret appeared in service logs",
  );
  assert(
    !logs.output.includes(process.env.OPENAI_API_KEY),
    "provider API key appeared in service logs",
  );
  const gatewayTurns = parseJsonLogLines(logs.output).filter(
    (record) =>
      record?.route === "default/google-adk" &&
      record?.["a2a.method"] === "SendMessage" &&
      record?.["a2a.context.id"] === contextId,
  );
  assert(
    gatewayTurns.length === 2,
    "gateway did not correlate both live Hermes turns",
  );
  assert(
    gatewayTurns.every((record) => record["jwt.sub"] === "hermes-live-client"),
    "gateway lost the live Hermes identity",
  );
  const adkTurns = parseAdkObservations(logs.output).filter(
    (record) => record.responseContextId === contextId,
  );
  assert(adkTurns.length === 2, "ADK did not log both live correlated turns");
  assert(
    adkTurns.every((record) => record.authorizationPresent === false),
    "gateway forwarded its Bearer token to the ADK backend",
  );

  console.log(`PASS: Hermes a2a_call continued live ADK context ${contextId}`);
  console.log("PASS: Hermes audit plus gateway and ADK correlation evidence");
} catch (error) {
  failure = error;
} finally {
  const cleanup = compose(
    ["--profile", "example-12-live", "down", "--volumes", "--remove-orphans"],
    false,
  );
  if (cleanup !== 0 && !failure) {
    failure = new Error(
      `live Example 12 cleanup failed with status ${cleanup}`,
    );
  }
  rmSync(providerSecretDirectory, { recursive: true, force: true });
}

if (failure) {
  console.error("\nExample 12 live integration: FAIL");
  console.error(
    redact(failure instanceof Error ? failure.stack : String(failure)),
  );
  process.exitCode = 1;
} else {
  console.log("\nExample 12 live integration: PASS");
}

function runHermes(prompt) {
  const result = composeCapture([
    "--profile",
    "example-12-live",
    "run",
    "--rm",
    "--no-deps",
    "hermes-tui",
    "python3",
    "/opt/letta-a2a/launch-hermes-tui.py",
    "--oneshot",
    prompt,
  ]);
  assert(
    result.status === 0,
    `Hermes one-shot failed:\n${redact(result.output)}`,
  );
  return result.output;
}

function readHermesContextId() {
  const result = dockerCapture([
    "run",
    "--rm",
    "--entrypoint",
    "/bin/ls",
    "-v",
    `${project}_hermes-state:/opt/data:ro`,
    HERMES_IMAGE,
    "-1",
    "/opt/data/a2a_conversations",
  ]);
  assert(result.status === 0, "could not read Hermes A2A conversation state");
  const contextIds = result.output
    .trim()
    .split("\n")
    .map((name) => name.match(/^(ctx-[0-9a-f]+)\.jsonl$/i)?.[1])
    .filter(Boolean);
  assert(
    contextIds.length === 1,
    `expected one authoritative Hermes context, got ${contextIds.length}`,
  );
  return contextIds[0];
}

function parseJsonLogLines(output) {
  return output
    .split("\n")
    .map((line) =>
      line.indexOf("{") >= 0 ? line.slice(line.indexOf("{")) : "",
    )
    .map((value) => {
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

function parseAdkObservations(output) {
  return output
    .split("\n")
    .map((line) => {
      const start = line.indexOf('{"authorizationPresent"');
      if (start < 0) return undefined;
      try {
        return JSON.parse(line.slice(start));
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

function compose(args, required = true) {
  const result = spawnSync("docker", ["compose", "-p", project, ...args], {
    cwd: process.cwd(),
    env: composeEnv,
    stdio: "inherit",
  });
  if (required && result.status !== 0) {
    throw new Error(
      `docker compose ${args.join(" ")} failed with ${result.status}`,
    );
  }
  return result.status ?? 1;
}

function composeCapture(args) {
  return dockerCapture(["compose", "-p", project, ...args], composeEnv);
}

function dockerCapture(args, env = process.env) {
  const result = spawnSync("docker", args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function redact(value) {
  return String(value)
    .split(clientSecret)
    .join("<redacted>")
    .split(process.env.OPENAI_API_KEY)
    .join("<redacted>");
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(String(port))));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
