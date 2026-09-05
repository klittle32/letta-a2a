#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installA2aCli } from "./install-a2acli.mjs";

const project =
  process.env.EXAMPLE_13_PROJECT ??
  `letta-a2a-example-13-${process.pid}-${randomUUID().slice(0, 8)}`;
const gatewayPort = await findFreePort();
const gatewayUiPort = await findFreePort();
const oauthPort = await findFreePort();
const identities = [
  {
    label: "Letta Code",
    slug: "letta-code",
    clientId: `letta-code-${randomUUID()}`,
    secret: `letta-${randomUUID()}-${randomUUID()}`,
    codeword: "ORCHID",
  },
  {
    label: "Codex",
    slug: "codex",
    clientId: `codex-${randomUUID()}`,
    secret: `codex-${randomUUID()}-${randomUUID()}`,
    codeword: "SAFFRON",
  },
];
const providerKey = "sk-provider-free-example-13";
const temporaryDirectory = mkdtempSync(join(tmpdir(), "letta-a2a-example-13-"));
const providerSecretPath = join(temporaryDirectory, "openai-api-key");
const binaryPath = join(temporaryDirectory, "a2acli");
const launcherPath = resolve("scripts/run-a2acli.mjs");
const workflowPath = resolve("skills/using-a2a-cli/scripts/run-workflow.mjs");
for (const identity of identities) {
  identity.secretFile = join(temporaryDirectory, `${identity.slug}-secret`);
  identity.cacheDir = join(temporaryDirectory, `${identity.slug}-cache`);
  writeFileSync(identity.secretFile, identity.secret, { mode: 0o600 });
  mkdirSync(identity.cacheDir, { mode: 0o700 });
}
writeFileSync(providerSecretPath, providerKey, { mode: 0o600 });
const composeEnv = {
  ...process.env,
  OPENAI_API_KEY: providerKey,
  OPENAI_API_KEY_SECRET_FILE: providerSecretPath,
  ADK_MODEL_MODE: "fake",
  A2A_GATEWAY_PORT: gatewayPort,
  A2A_GATEWAY_UI_PORT: gatewayUiPort,
  OAUTH_PORT: oauthPort,
  OAUTH_LETTA_CODE_CLIENT_ID: identities[0].clientId,
  OAUTH_LETTA_CODE_CLIENT_SECRET: identities[0].secret,
  OAUTH_CODEX_CLIENT_ID: identities[1].clientId,
  OAUTH_CODEX_CLIENT_SECRET: identities[1].secret,
};
const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}/a2a/google-adk`;
const tokenUrl = `http://127.0.0.1:${oauthPort}/token`;

let failure;
try {
  compose([
    "--profile",
    "example-12",
    "up",
    "--build",
    "--detach",
    "--wait",
    "--wait-timeout",
    "240",
    "google-adk-agent",
    "agentgateway",
  ]);
  await installA2aCli({ destination: binaryPath });
  chmodSync(binaryPath, 0o700);

  const correlations = [];
  for (const identity of identities) correlations.push(runChecks(identity));
  assert(
    identities[0].accessToken !== identities[1].accessToken,
    "OAuth identities shared an access token",
  );
  assert(
    identities[0].claims.sub !== identities[1].claims.sub,
    "OAuth identities shared a subject",
  );
  assert(
    correlations[0].contextId !== correlations[1].contextId,
    "OAuth identities shared a workflow context",
  );
  passed("separate OAuth subjects, tokens, caches, and contexts");
  assertLogsAndCorrelation(correlations);
} catch (error) {
  failure = error;
  const captured = composeCapture([
    "--profile",
    "example-12",
    "logs",
    "--no-color",
    "--tail",
    "200",
  ]);
  if (captured.output) process.stderr.write(redact(captured.output));
} finally {
  const cleanup = compose(
    ["--profile", "example-12", "down", "--volumes", "--remove-orphans"],
    false,
  );
  if (cleanup !== 0 && !failure) {
    failure = new Error(`Example 13 cleanup failed with status ${cleanup}`);
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

if (failure) {
  console.error("\nExample 13 provider-free integration: FAIL");
  console.error(
    redact(
      failure instanceof Error
        ? (failure.stack ?? failure.message)
        : String(failure),
    ),
  );
  process.exitCode = 1;
} else {
  console.log("\nExample 13 provider-free integration: PASS");
}

function runChecks(identity) {
  const environment = identityEnvironment(identity);
  const card = invokeLauncher(identity, environment, ["card"]);
  assertCard(card);

  const stored = runWorkflow(
    identity,
    environment,
    `Remember the codeword ${identity.codeword} and reply STORED.`,
  );

  const cacheFiles = readdirSync(identity.cacheDir);
  assert(
    cacheFiles.length === 1 && cacheFiles[0].endsWith(".json"),
    `${identity.label} cache is not exactly one file`,
  );
  assert(
    (lstatSync(identity.cacheDir).mode & 0o777) === 0o700,
    `${identity.label} cache directory is not private`,
  );
  const cachePath = join(identity.cacheDir, cacheFiles[0]);
  assert(
    (lstatSync(cachePath).mode & 0o777) === 0o600,
    `${identity.label} cache file is not private`,
  );
  const cache = JSON.parse(readFileSync(cachePath, "utf8"));
  assert(
    cache.clientId === identity.clientId,
    `${identity.label} cache has the wrong client ID`,
  );
  assert(
    cache.tokenUrl === tokenUrl,
    `${identity.label} cache has the wrong token URL`,
  );
  assert(
    cache.gatewayUrl === gatewayBaseUrl,
    `${identity.label} cache has the wrong gateway URL`,
  );
  assert(
    cache.scope === "a2a.discover a2a.invoke",
    `${identity.label} cache has the wrong scopes`,
  );
  assert(
    typeof cache.accessToken === "string" && cache.accessToken.length > 0,
    `${identity.label} cache has no access token`,
  );
  identity.accessToken = cache.accessToken;
  identity.claims = decodeJwtClaims(cache.accessToken);
  assert(
    identity.claims.sub === identity.clientId,
    `${identity.label} token has the wrong subject`,
  );
  assert(
    identity.claims.role === "agent",
    `${identity.label} token has the wrong role`,
  );
  assert(
    identity.claims.scope === "a2a.discover a2a.invoke",
    `${identity.label} token has the wrong scopes`,
  );
  assert(
    Number(identity.claims.exp) - Number(identity.claims.iat) === 900,
    `${identity.label} token TTL is not 900 seconds`,
  );
  assert(
    cache.expiresAtMs === Number(identity.claims.exp) * 1000,
    `${identity.label} cache expiry disagrees with its JWT`,
  );
  passed(
    `private one-file cache and exact 900-second claims for ${identity.label}`,
  );

  assertWorkflowResult(stored, {
    text: `STORED: ${identity.codeword}`,
    label: `${identity.label} store`,
  });
  const contextId = stored.contextId;
  assert(
    typeof contextId === "string" && contextId.length > 0,
    `${identity.label} store has no context ID`,
  );
  assert(
    typeof stored.taskId === "string" && stored.taskId.length > 0,
    `${identity.label} store has no task ID`,
  );

  const recalled = runWorkflow(
    identity,
    environment,
    "What codeword did I ask you to remember?",
    contextId,
  );
  assertWorkflowResult(recalled, {
    text: identity.codeword,
    label: `${identity.label} recall`,
  });
  assert(
    recalled.contextId === contextId,
    `${identity.label} recall changed the exact context ID`,
  );
  assert(
    typeof recalled.taskId === "string" && recalled.taskId.length > 0,
    `${identity.label} recall has no task ID`,
  );
  assert(
    recalled.taskId !== stored.taskId,
    `${identity.label} workflow turns shared a task ID`,
  );

  const isolated = runWorkflow(
    identity,
    environment,
    "What codeword did I ask you to remember?",
  );
  assertWorkflowResult(isolated, {
    text: "UNKNOWN",
    label: `${identity.label} isolated recall`,
  });
  assert(
    typeof isolated.contextId === "string" && isolated.contextId.length > 0,
    `${identity.label} isolated recall has no context ID`,
  );
  assert(
    isolated.contextId !== contextId,
    `${identity.label} isolated recall reused the stored context`,
  );
  assert(
    typeof isolated.taskId === "string" && isolated.taskId.length > 0,
    `${identity.label} isolated recall has no task ID`,
  );
  assert(
    ![stored.taskId, recalled.taskId].includes(isolated.taskId),
    `${identity.label} isolated recall reused a task ID`,
  );

  passed(
    `store, exact-context recall, isolation, and protected card for ${identity.label}`,
  );
  return { subject: identity.clientId, contextId };
}

function runWorkflow(identity, environment, text, contextId) {
  const args = [workflowPath, "--text", text];
  if (contextId !== undefined) args.push("--context-id", contextId);
  return invokeNode(identity, environment, args, "workflow");
}

function invokeLauncher(identity, environment, args) {
  return invokeNode(identity, environment, [launcherPath, ...args], "launcher");
}

function invokeNode(identity, environment, args, operation) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: environment,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assertNoCredential(output, `${identity.label} ${operation} output`);
  assert(
    result.status === 0,
    `${identity.label} ${operation} failed: ${redact(result.stderr ?? "")}`,
  );
  try {
    const payload = JSON.parse(result.stdout);
    return payload;
  } catch {
    throw new Error(`${identity.label} ${operation} returned malformed JSON`);
  }
}

function identityEnvironment(identity) {
  return {
    ...process.env,
    A2ACLI_BIN: binaryPath,
    A2A_CLI_LAUNCHER: launcherPath,
    A2A_CLI_GATEWAY_URL: gatewayBaseUrl,
    A2A_CLI_TOKEN_URL: tokenUrl,
    A2A_CLI_CLIENT_ID: identity.clientId,
    A2A_CLI_CLIENT_SECRET_FILE: identity.secretFile,
    A2A_CLI_CACHE_DIR: identity.cacheDir,
  };
}

function assertWorkflowResult(result, { text, label }) {
  assert(result.outcome === "task", `${label} did not return a task`);
  assert(result.state === "completed", `${label} did not complete`);
  assert(result.text === text, `${label} returned unexpected text`);
}

function assertCard(card) {
  assert(
    card.name === "Google ADK Conversation Agent",
    "unexpected ADK card name",
  );
  const interfaces = card.supportedInterfaces;
  assert(
    Array.isArray(interfaces) && interfaces.length > 0,
    "ADK card has no interfaces",
  );
  const jsonrpc = interfaces.filter(
    (item) => item.protocolBinding === "JSONRPC",
  );
  assert(
    jsonrpc.some((item) => item.protocolVersion === "1.0"),
    "ADK card does not advertise A2A 1.0 JSON-RPC",
  );
  for (const item of jsonrpc) {
    const url = new URL(item.url);
    assert(
      url.hostname === "127.0.0.1",
      `card leaked interface host ${url.hostname}`,
    );
    assert(
      url.port === String(gatewayPort),
      `card advertised interface port ${url.port}`,
    );
    assert(
      url.pathname.replace(/\/$/, "") === "/a2a/google-adk",
      `card advertised interface path ${url.pathname}`,
    );
  }
  const serialized = JSON.stringify(card);
  for (const forbidden of [
    "google-adk-agent",
    ":8000",
    "0.0.0.0",
    ...credentialValues(),
  ]) {
    if (forbidden)
      assert(
        !serialized.includes(forbidden),
        "card exposed a backend address or credential",
      );
  }
  const oauth = card.securitySchemes?.a2aOAuth?.oauth2SecurityScheme;
  assert(
    oauth?.flows?.clientCredentials,
    "ADK card has no OAuth client-credentials flow",
  );
  assert(
    oauth.flows.clientCredentials.tokenUrl === tokenUrl,
    "ADK card advertises the wrong token URL",
  );
  assert(
    JSON.stringify(card.securityRequirements ?? []).includes("a2a.invoke"),
    "ADK card does not require a2a.invoke",
  );
}

function assertLogsAndCorrelation(correlations) {
  const captured = composeCapture([
    "--profile",
    "example-12",
    "logs",
    "--no-color",
    "auth-server",
    "agentgateway",
    "google-adk-agent",
  ]);
  assert(captured.status === 0, "could not inspect Example 13 logs");
  assertNoCredential(captured.output, "Example 13 logs");

  const records = captured.output
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
  const observations = records.filter(
    (record) => "authorizationPresent" in record,
  );
  for (const expected of correlations) {
    const backendTurns = observations.filter(
      (item) => item.responseContextId === expected.contextId,
    );
    assert(
      backendTurns.length === 2,
      "ADK logs omitted the two exact-context turns",
    );
    assert(
      backendTurns.every((item) => item.authorizationPresent === false),
      "gateway forwarded the caller Bearer token to the backend",
    );
    const gatewayTurns = records.filter(
      (record) =>
        record?.route === "default/google-adk" &&
        record?.["a2a.method"] === "SendMessage" &&
        record?.["a2a.context.id"] === expected.contextId,
    );
    assert(
      gatewayTurns.length === 2,
      "gateway did not log both exact-context turns",
    );
    assert(
      gatewayTurns.every((record) => record["jwt.sub"] === expected.subject),
      "gateway lost explicit OAuth identity attribution",
    );
  }
  passed(
    "gateway attribution, backend token stripping, and credential redaction",
  );
}

function assertNoCredential(value, location) {
  for (const secret of credentialValues()) {
    if (secret)
      assert(
        !value.includes(secret),
        `${location} exposed a cached token or secret`,
      );
  }
}

function credentialValues() {
  return [
    providerKey,
    ...identities.flatMap((identity) => [
      identity.secret,
      identity.accessToken,
      Buffer.from(`${identity.clientId}:${identity.secret}`).toString("base64"),
    ]),
  ];
}

function decodeJwtClaims(token) {
  const parts = token.split(".");
  assert(parts.length === 3, "cached access token is not a compact JWT");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
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
  const result = spawnSync("docker", ["compose", "-p", project, ...args], {
    cwd: process.cwd(),
    env: composeEnv,
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function redact(value) {
  let redacted = value;
  for (const secret of credentialValues()) {
    if (secret) redacted = redacted.split(secret).join("<redacted>");
  }
  return redacted;
}

async function findFreePort() {
  return await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) =>
        error ? reject(error) : resolvePromise(String(port)),
      );
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function passed(message) {
  console.log(`PASS: ${message}`);
}
