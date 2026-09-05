#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const project =
  process.env.EXAMPLE_12_PROJECT ??
  `letta-a2a-example-12-${process.pid}-${randomUUID().slice(0, 8)}`;
const gatewayPort = await findFreePort();
const gatewayUiPort = await findFreePort();
const oauthPort = await findFreePort();
const clientId = "hermes-example-12-client";
const clientSecret = `hermes-${randomUUID()}-${randomUUID()}`;
const providerKey = "sk-provider-free-example-12";
const providerSecretDirectory = mkdtempSync(
  join(tmpdir(), "letta-a2a-example-12-"),
);
const providerSecretPath = join(providerSecretDirectory, "openai-api-key");
writeFileSync(providerSecretPath, providerKey, { mode: 0o600 });
const composeEnv = {
  ...process.env,
  OPENAI_API_KEY: providerKey,
  OPENAI_API_KEY_SECRET_FILE: providerSecretPath,
  ADK_MODEL_MODE: "fake",
  A2A_GATEWAY_PORT: gatewayPort,
  A2A_GATEWAY_UI_PORT: gatewayUiPort,
  OAUTH_PORT: oauthPort,
  OAUTH_HERMES_CLIENT_ID: clientId,
  HERMES_OAUTH_CLIENT_SECRET: clientSecret,
  OAUTH_HERMES_TOKEN_TTL_SECONDS: "900",
};
const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}/a2a/google-adk`;
const tokenUrl = `http://127.0.0.1:${oauthPort}/token`;

let failure;
let accessToken = "";
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
  accessToken = await requestAccessToken();
  await runChecks();
  assertLogsAndCorrelation();
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
    failure = new Error(`Example 12 cleanup failed with status ${cleanup}`);
  }
  rmSync(providerSecretDirectory, { recursive: true, force: true });
}

if (failure) {
  console.error("\nExample 12 provider-free integration: FAIL");
  console.error(failure instanceof Error ? failure.stack : String(failure));
  process.exitCode = 1;
} else {
  console.log("\nExample 12 provider-free integration: PASS");
}

async function runChecks() {
  const claims = decodeJwtClaims(accessToken);
  assert(claims.sub === clientId, "Hermes token has the wrong subject");
  assert(claims.role === "agent", "Hermes token has the wrong role");
  assert(
    claims.scope === "a2a.discover a2a.invoke",
    "Hermes token has the wrong scopes",
  );
  assert(
    Number(claims.exp) - Number(claims.iat) === 900,
    "Hermes token TTL is not 900 seconds",
  );
  passed("dedicated short-lived Hermes OAuth identity");

  const cardUrl = `${gatewayBaseUrl}/.well-known/agent-card.json`;
  const missing = await fetch(cardUrl);
  const malformed = await fetch(cardUrl, {
    headers: { Authorization: "Bearer not-a-jwt" },
  });
  assert(
    missing.status === 401,
    `missing card auth returned ${missing.status}`,
  );
  assert(
    malformed.status === 401,
    `bad card auth returned ${malformed.status}`,
  );

  const response = await fetch(cardUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert(response.status === 200, `card fetch returned ${response.status}`);
  const card = await response.json();
  assertCard(card);
  passed("protected and gateway-rewritten Google ADK Agent Card");

  const firstRequestId = `request-${randomUUID()}`;
  const firstMessageId = `message-${randomUUID()}`;
  const first = taskFrom(
    await rpc(
      firstRequestId,
      firstMessageId,
      "Remember the codeword ORCHID and reply STORED.",
    ),
  );
  assert(
    taskState(first) === "TASK_STATE_COMPLETED",
    "first ADK task did not complete",
  );
  assert(
    artifactText(first) === "STORED: ORCHID",
    "ADK did not store the codeword",
  );
  const contextId = first.contextId;
  assert(
    typeof contextId === "string" && contextId,
    "first ADK task has no context ID",
  );

  const secondRequestId = `request-${randomUUID()}`;
  const secondMessageId = `message-${randomUUID()}`;
  const second = taskFrom(
    await rpc(
      secondRequestId,
      secondMessageId,
      "What codeword did I ask you to remember?",
      contextId,
    ),
  );
  assert(
    taskState(second) === "TASK_STATE_COMPLETED",
    "second ADK task did not complete",
  );
  assert(artifactText(second) === "ORCHID", "ADK did not continue the context");
  assert(
    second.contextId === contextId,
    "ADK changed the continued context ID",
  );

  const isolated = taskFrom(
    await rpc(
      `request-${randomUUID()}`,
      `message-${randomUUID()}`,
      "What codeword did I ask you to remember?",
    ),
  );
  assert(
    artifactText(isolated) === "UNKNOWN",
    "a new context inherited old ADK history",
  );
  assert(
    isolated.contextId !== contextId,
    "ADK reused a context without being asked",
  );

  globalThis.expectedCorrelation = {
    contextId,
    requestIds: [firstRequestId, secondRequestId],
    messageIds: [firstMessageId, secondMessageId],
  };
  passed("two-turn Google ADK context continuation through agentgateway");
}

async function rpc(requestId, messageId, text, contextId = undefined) {
  const response = await fetch(gatewayBaseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "A2A-Version": "1.0",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "SendMessage",
      params: {
        message: {
          messageId,
          ...(contextId ? { contextId } : {}),
          role: "ROLE_USER",
          parts: [{ text }],
        },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.text();
  assert(
    response.status === 200,
    `SendMessage returned ${response.status}: ${body}`,
  );
  const payload = JSON.parse(body);
  assert(
    !payload.error,
    `SendMessage returned ${JSON.stringify(payload.error)}`,
  );
  return payload;
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
    clientSecret,
  ]) {
    assert(
      !serialized.includes(forbidden),
      `card exposed forbidden value ${forbidden}`,
    );
  }
  const oauth = card.securitySchemes?.a2aOAuth?.oauth2SecurityScheme;
  assert(
    oauth?.flows?.clientCredentials,
    "ADK card has no OAuth client-credentials flow",
  );
  assert(
    oauth.flows.clientCredentials.tokenUrl ===
      `http://127.0.0.1:${oauthPort}/token`,
    "ADK card advertises the wrong token URL",
  );
  assert(
    card.securityRequirements?.some((requirement) =>
      requirement.schemes?.a2aOAuth?.list?.includes("a2a.invoke"),
    ),
    "ADK card does not require a2a.invoke",
  );
}

function assertLogsAndCorrelation() {
  const captured = composeCapture([
    "--profile",
    "example-12",
    "logs",
    "--no-color",
    "auth-server",
    "agentgateway",
    "google-adk-agent",
  ]);
  assert(captured.status === 0, "could not inspect Example 12 logs");
  for (const secret of [
    clientSecret,
    accessToken,
    providerKey,
    Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
  ]) {
    assert(
      !captured.output.includes(secret),
      "an Example 12 credential appeared in logs",
    );
  }

  const expected = globalThis.expectedCorrelation;
  const observations = captured.output
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
  for (const [index, requestId] of expected.requestIds.entries()) {
    const observation = observations.find(
      (item) => item.requestId === requestId,
    );
    assert(observation, `ADK log omitted request ${requestId}`);
    assert(
      observation.messageId === expected.messageIds[index],
      "ADK logged the wrong message ID",
    );
    assert(
      observation.responseContextId === expected.contextId,
      "ADK logged the wrong response context",
    );
    assert(
      observation.authorizationPresent === false,
      "gateway forwarded its Bearer token",
    );
  }

  const gatewayRecords = captured.output
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
    .filter(
      (record) =>
        record?.route === "default/google-adk" &&
        record?.["a2a.method"] === "SendMessage" &&
        record?.["a2a.context.id"] === expected.contextId,
    );
  assert(
    gatewayRecords.length === 2,
    "gateway did not log both continued ADK turns",
  );
  assert(
    gatewayRecords.every((record) => record["jwt.sub"] === clientId),
    "gateway lost Hermes attribution",
  );
  passed("redacted gateway and ADK correlation evidence");
}

async function requestAccessToken() {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "a2a.discover a2a.invoke",
    }),
  });
  const payload = await response.json();
  assert(response.status === 200, `OAuth exchange returned ${response.status}`);
  assert(
    payload.token_type === "Bearer",
    "OAuth exchange returned the wrong token type",
  );
  assert(payload.expires_in === 900, "OAuth exchange returned the wrong TTL");
  assert(
    typeof payload.access_token === "string",
    "OAuth exchange returned no token",
  );
  return payload.access_token;
}

function taskFrom(payload) {
  const result = payload?.result;
  const task = result?.task ?? result;
  assert(task?.id, "A2A response has no task");
  return task;
}

function taskState(task) {
  return String(task?.status?.state ?? "");
}

function artifactText(task) {
  return (task?.artifacts ?? [])
    .flatMap((artifact) => artifact.parts ?? [])
    .map((part) => part.text ?? "")
    .join("");
}

function decodeJwtClaims(token) {
  const parts = token.split(".");
  assert(parts.length === 3, "access token is not a compact JWT");
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
  for (const secret of [clientSecret, accessToken, providerKey]) {
    if (secret) redacted = redacted.split(secret).join("<redacted>");
  }
  return redacted;
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

function passed(message) {
  console.log(`PASS: ${message}`);
}
