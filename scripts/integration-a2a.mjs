#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

const managed = process.env.A2A_INTEGRATION_NO_MANAGE !== "1";
const liveLetta =
  !process.argv.includes("--protocol-only") &&
  process.env.A2A_SKIP_LIVE_LETTA !== "1";
const project =
  process.env.A2A_INTEGRATION_PROJECT ??
  `letta-a2a-integration-${process.pid}-${randomUUID().slice(0, 8)}`;
const gatewayPort =
  process.env.A2A_INTEGRATION_GATEWAY_PORT ??
  process.env.A2A_GATEWAY_PORT ??
  (managed ? await findFreePort() : "4000");
const gatewayUiPort =
  process.env.A2A_INTEGRATION_GATEWAY_UI_PORT ??
  process.env.A2A_GATEWAY_UI_PORT ??
  (managed ? await findFreePort() : "4090");
const oauthPort =
  process.env.A2A_INTEGRATION_OAUTH_PORT ??
  process.env.OAUTH_PORT ??
  (managed ? await findFreePort() : "9000");
const oauthTokenUrl = `http://127.0.0.1:${oauthPort}/token`;
const oauthIssuer = `http://127.0.0.1:${oauthPort}`;
const oauthClientId = process.env.OAUTH_CLIENT_ID ?? "operator-client";
const oauthClientSecret =
  process.env.OAUTH_CLIENT_SECRET ?? "operator-client-secret";
const oauthScope = "a2a.discover a2a.invoke";
const discoverScope = "a2a.discover";
const invokeScope = "a2a.invoke";
const observerClientId = process.env.OAUTH_OBSERVER_CLIENT_ID ?? "observer-client";
const observerClientSecret =
  process.env.OAUTH_OBSERVER_CLIENT_SECRET ?? "observer-client-secret";
const deniedClientId =
  process.env.OAUTH_DENIED_CLIENT_ID ?? "denied-invoker-client";
const deniedClientSecret =
  process.env.OAUTH_DENIED_CLIENT_SECRET ?? "denied-invoker-client-secret";
const bridgeClientSecret =
  process.env.OAUTH_BRIDGE_CLIENT_SECRET ?? "bridge-client-secret";
const referenceClientSecret =
  process.env.OAUTH_REFERENCE_CLIENT_SECRET ?? "reference-agent-client-secret";
const issuedTokens = new Set();
const tokenProvider = createTokenProvider({
  tokenUrl: oauthTokenUrl,
  clientId: oauthClientId,
  clientSecret: oauthClientSecret,
  scope: oauthScope,
  refreshSkewMs: 1_000,
});
const composeEnv = {
  ...process.env,
  A2A_GATEWAY_PORT: gatewayPort,
  A2A_GATEWAY_UI_PORT: gatewayUiPort,
  OAUTH_PORT: oauthPort,
  OAUTH_CLIENT_ID: oauthClientId,
  OAUTH_CLIENT_SECRET: oauthClientSecret,
  OAUTH_OBSERVER_CLIENT_ID: observerClientId,
  OAUTH_OBSERVER_CLIENT_SECRET: observerClientSecret,
  OAUTH_DENIED_CLIENT_ID: deniedClientId,
  OAUTH_DENIED_CLIENT_SECRET: deniedClientSecret,
  ...(managed
    ? {
        OAUTH_STALE_CLIENT_SECRET: "stale-client-secret",
      }
    : {}),
  OAUTH_TOKEN_TTL_SECONDS: managed ? "6" : process.env.OAUTH_TOKEN_TTL_SECONDS,
  ...(!liveLetta && !process.env.OPENAI_API_KEY
    ? { OPENAI_API_KEY: "sk-unused-reference-only" }
    : {}),
};
const agentA = createClient(`http://127.0.0.1:${gatewayPort}`, "agent-a");
const reference = createClient(
  `http://127.0.0.1:${gatewayPort}`,
  "reference-agent",
);

let failure;
try {
  if (managed) {
    compose([
      "up",
      "--build",
      "--detach",
      "--wait",
      "--wait-timeout",
      "240",
      "reference-agent",
      "agentgateway",
      ...(liveLetta ? ["bridge"] : []),
    ]);
  }

  await runChecks();
  if (managed) assertLogsOmitCredentials();
} catch (error) {
  failure = error;
  if (managed) {
    const captured = composeCapture(["logs", "--no-color", "--tail", "200"]);
    if (captured.output) process.stderr.write(redactCredentials(captured.output));
  }
} finally {
  if (managed) {
    const cleanupStatus = compose(
      ["down", "--volumes", "--remove-orphans"],
      false,
    );
    if (cleanupStatus !== 0 && !failure) {
      failure = new Error(
        `integration checks passed, but Compose cleanup failed with ${cleanupStatus}`,
      );
    }
  }
}

if (failure) {
  console.error("\nIndependent A2A integration: FAIL");
  console.error(failure instanceof Error ? failure.stack : String(failure));
  process.exitCode = 1;
} else {
  console.log("\nIndependent A2A integration: PASS");
}

async function runChecks() {
  const card = await waitForCard(reference);
  await assertGatewayAuthentication();
  assertGatewayCard(card, "Independent Reference Agent", "reference-agent");
  passed("Agent Card discovery through agentgateway");

  const referenceStream = assertStreamingEvents(
    await reference.stream("stream REFERENCE_STREAM_OK"),
    "REFERENCE_STREAM_OK",
  );
  const streamedReferenceTask = taskFromPayload(
    await reference.rpc("GetTask", { id: referenceStream.taskId }),
  );
  assert(streamedReferenceTask, "streamed reference task was not persisted");
  assert(
    artifactText(streamedReferenceTask) === "REFERENCE_STREAM_OK",
    "streamed reference task persisted the wrong artifact",
  );
  passed("reference-agent ordered SSE artifact streaming");

  const failedStream = await reference.stream("fail STREAM_FAILURE");
  const failedStatus = failedStream.at(-1)?.statusUpdate?.status;
  assert(
    String(failedStatus?.state ?? "").endsWith("FAILED") &&
      messageText(failedStatus?.message) === "STREAM_FAILURE",
    "streaming failure did not end with its explicit failure detail",
  );
  assert(
    !failedStream.some((result) => result.artifactUpdate?.lastChunk),
    "failed stream published a final artifact chunk",
  );
  passed("streaming failure remains explicit and non-final");

  const disconnectedStream = await reference.stream("slow 1", undefined, {
    stopWhen: async (result, results) => {
      if (!String(result.statusUpdate?.status?.state ?? "").endsWith("WORKING")) {
        return false;
      }
      const taskId = results[0]?.task?.id;
      const whileConnected = taskFromPayload(
        await reference.rpc("GetTask", { id: taskId }),
      );
      assert(
        taskState(whileConnected).endsWith("WORKING"),
        "gateway did not deliver SSE before the task completed",
      );
      return true;
    },
  });
  const disconnectedTask = disconnectedStream.find((result) => result.task)?.task;
  assert(disconnectedTask?.id, "disconnected stream returned no task ID");
  assert(
    !disconnectedStream.some((result) =>
      String(result.statusUpdate?.status?.state ?? "").endsWith("COMPLETED"),
    ),
    "disconnect probe consumed the terminal stream event",
  );
  const afterDisconnect = await reference.pollUntil(
    disconnectedTask.id,
    (task) => isTerminal(taskState(task)),
  );
  assert(
    taskState(afterDisconnect).endsWith("COMPLETED") &&
      artifactText(afterDisconnect) === "slept: 1",
    "disconnect unexpectedly canceled or lost the server-side task",
  );
  passed("SSE disconnect leaves task execution and retrieval intact");

  const echo = await reference.sendAndPoll("echo REFERENCE_DIRECT_OK");
  assert(echo.pollCount > 0, "async echo completed without a GetTask poll");
  assert(echo.state.endsWith("COMPLETED"), `echo ended as ${echo.state}`);
  assert(echo.text === "REFERENCE_DIRECT_OK", `unexpected echo: ${echo.text}`);
  passed("asynchronous SendMessage and GetTask");

  const remembered = await reference.sendAndPoll("remember INTEGRATION_TOKEN");
  assert(remembered.state.endsWith("COMPLETED"), "remember did not complete");
  const recalled = await reference.sendAndPoll(
    "context",
    remembered.contextId,
  );
  assert(recalled.text === "INTEGRATION_TOKEN", `unexpected context: ${recalled.text}`);
  passed("context continuation");

  const failure = await reference.sendAndPoll("fail REFERENCE_FAILURE");
  assert(failure.state.endsWith("FAILED"), `failure ended as ${failure.state}`);
  assert(
    failure.statusText === "REFERENCE_FAILURE",
    `unexpected failure detail: ${failure.statusText}`,
  );
  passed("terminal failure propagation");

  const slow = await reference.send("slow 1");
  const working = await reference.pollUntil(
    slow.id,
    (task) => taskState(task).endsWith("WORKING"),
  );
  assert(taskState(working).endsWith("WORKING"), "slow task never reached working");
  const canceled = await reference.rpc("CancelTask", { id: slow.id });
  const canceledTask = taskFromPayload(canceled);
  assert(canceledTask, "CancelTask returned no task");
  assert(
    taskState(canceledTask).endsWith("CANCELED"),
    `cancel ended as ${taskState(canceledTask)}`,
  );
  await sleep(1_200);
  const afterOriginalDeadline = taskFromPayload(
    await reference.rpc("GetTask", { id: slow.id }),
  );
  assert(afterOriginalDeadline, "canceled task disappeared from the task store");
  assert(
    taskState(afterOriginalDeadline).endsWith("CANCELED"),
    `canceled task later changed to ${taskState(afterOriginalDeadline)}`,
  );
  passed("deterministic cancellation remains terminal");

  if (liveLetta) {
    const lettaCard = await agentA.card();
    assertGatewayCard(lettaCard, "Agent A", "agent-a");
    passed("Letta Agent Card preservation and URL rewriting");

    const lettaStream = assertStreamingEvents(
      await agentA.stream(
        "Reply with exactly LETTA_STREAM_OK and nothing else.",
      ),
      "LETTA_STREAM_OK",
    );
    const storedLettaStream = taskFromPayload(
      await agentA.rpc("GetTask", { id: lettaStream.taskId }),
    );
    assert(
      storedLettaStream && artifactText(storedLettaStream) === "LETTA_STREAM_OK",
      "streamed Letta task did not persist its assembled artifact",
    );
    passed("safe Letta assistant text streamed through A2A SSE");

    const delegated = await agentA.sendAndPoll(
      "Use a2a_invoke with target reference-agent and message 'echo LETTA_REFERENCE_OK'. Then return only the reference agent's answer.",
    );
    assert(
      delegated.state.endsWith("COMPLETED"),
      `Letta task ended as ${delegated.state}`,
    );
    assert(
      delegated.text === "LETTA_REFERENCE_OK",
      `unexpected Letta delegation result: ${delegated.text}`,
    );
    passed("provider-backed Letta Agent A to independent reference agent");

    const reverseDelegated = await reference.sendAndPoll(
      "ask-letta Reply with exactly EXTERNAL_TO_LETTA_OK and nothing else.",
    );
    assert(
      reverseDelegated.state.endsWith("COMPLETED"),
      `external-to-Letta task ended as ${reverseDelegated.state}: ${reverseDelegated.statusText}`,
    );
    assert(
      reverseDelegated.text === "EXTERNAL_TO_LETTA_OK",
      `unexpected external-to-Letta result: ${reverseDelegated.text}`,
    );
    passed("independent reference agent to Letta Agent A delegation");

    const priorSlowTask = await reference.sendAndPoll("last-slow");
    const outer = await agentA.send(
      "Use a2a_invoke now with target reference-agent and message 'slow 30'. Wait for its result. Do not answer without using the tool.",
    );
    const childTaskId = await waitForReferenceObservation(
      "last-slow",
      (value) => value !== "(none)" && value !== priorSlowTask.text,
    );

    const outerCanceled = taskFromPayload(
      await agentA.rpc("CancelTask", { id: outer.id }),
    );
    assert(outerCanceled, "outer CancelTask returned no task");
    assert(
      taskState(outerCanceled).endsWith("CANCELED"),
      `outer cancel ended as ${taskState(outerCanceled)}`,
    );
    await waitForReferenceObservation(
      "last-canceled",
      (value) => value === childTaskId,
    );

    const childCanceled = taskFromPayload(
      await reference.rpc("GetTask", { id: childTaskId }),
    );
    assert(childCanceled, "remote child task disappeared after outer cancellation");
    assert(
      taskState(childCanceled).endsWith("CANCELED"),
      `remote child ended as ${taskState(childCanceled)}`,
    );

    await sleep(500);
    const stableOuter = taskFromPayload(
      await agentA.rpc("GetTask", { id: outer.id }),
    );
    const stableChild = taskFromPayload(
      await reference.rpc("GetTask", { id: childTaskId }),
    );
    assert(
      stableOuter && taskState(stableOuter).endsWith("CANCELED"),
      `outer task did not remain canceled: ${taskState(stableOuter)}`,
    );
    assert(
      stableChild && taskState(stableChild).endsWith("CANCELED"),
      `remote child did not remain canceled: ${taskState(stableChild)}`,
    );
    passed("outer cancellation propagates to the remote child task");
  }
}

function assertGatewayCard(card, expectedName, target) {
  assert(card.name === expectedName, `unexpected ${target} Agent Card name`);
  assert(
    card.protocolVersion === "1.0" ||
      card.supportedInterfaces?.some(
        (item) => item.protocolVersion === "1.0",
      ),
    `${target} Agent Card does not advertise A2A 1.0`,
  );
  assert(
    Array.isArray(card.skills) && card.skills.length > 0,
    `${target} Agent Card lost its skills`,
  );
  assert(card.capabilities, `${target} Agent Card lost its capabilities`);
  assert(
    card.capabilities.streaming === true,
    `${target} Agent Card does not advertise streaming`,
  );
  const oauth = card.securitySchemes?.a2aOAuth?.oauth2SecurityScheme;
  const clientCredentials = oauth?.flows?.clientCredentials;
  assert(clientCredentials, `${target} Agent Card lost OAuth client credentials`);
  assert(
    clientCredentials.tokenUrl === oauthTokenUrl,
    `${target} Agent Card advertises the wrong token URL`,
  );
  assert(
    clientCredentials.scopes?.[discoverScope],
    `${target} Agent Card lost the ${discoverScope} scope`,
  );
  assert(
    clientCredentials.scopes?.[invokeScope],
    `${target} Agent Card lost the ${invokeScope} scope`,
  );
  assert(
    oauth.oauth2MetadataUrl ===
      `${oauthIssuer}/.well-known/oauth-authorization-server`,
    `${target} Agent Card advertises the wrong OAuth metadata URL`,
  );
  assert(
    card.securityRequirements?.some(
      (requirement) =>
        requirement.schemes?.a2aOAuth?.list?.includes(invokeScope),
    ),
    `${target} Agent Card does not require the advertised OAuth scope`,
  );
  assert(
    !JSON.stringify(card).includes(oauthClientSecret),
    `${target} Agent Card exposed the OAuth client secret`,
  );
  const interfaceV1 = card.supportedInterfaces?.find(
    (item) => item.protocolVersion === "1.0",
  );
  assert(interfaceV1?.url, `${target} Agent Card has no A2A 1.0 interface URL`);
  const advertised = new URL(interfaceV1.url);
  assert(
    advertised.hostname === "127.0.0.1" &&
      advertised.port === String(gatewayPort) &&
      advertised.pathname.replace(/\/$/, "") === `/a2a/${target}`,
    `${target} Agent Card advertises an unreachable interface: ${interfaceV1.url}`,
  );
}

async function assertGatewayAuthentication() {
  const cardUrl = `http://127.0.0.1:${gatewayPort}/a2a/reference-agent/.well-known/agent-card.json`;
  const rpcUrl = `http://127.0.0.1:${gatewayPort}/a2a/reference-agent`;
  const missing = await fetch(cardUrl);
  assert(
    missing.status === 401,
    `missing access token returned ${missing.status}, expected 401`,
  );
  const wrong = await fetch(cardUrl, {
    headers: { Authorization: "Bearer not-a-jwt" },
  });
  assert(
    wrong.status === 401,
    `malformed access token returned ${wrong.status}, expected 401`,
  );
  const accessToken = await tokenProvider.getAccessToken();
  const valid = await fetch(cardUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert(
    valid.status === 200,
    `valid access token returned ${valid.status}, expected 200`,
  );
  const claims = decodeJwtClaims(accessToken);
  assert(claims.iss === oauthIssuer, `unexpected token issuer: ${claims.iss}`);
  assert(
    claims.aud === "letta-a2a-gateway",
    `unexpected token audience: ${claims.aud}`,
  );
  assert(claims.sub === oauthClientId, `unexpected token subject: ${claims.sub}`);
  assert(claims.role === "operator", `unexpected token role: ${claims.role}`);
  assert(claims.scope === oauthScope, `unexpected token scope: ${claims.scope}`);
  assert(
    Number(claims.exp) > Math.floor(Date.now() / 1_000),
    "authorization server issued an already-expired token",
  );

  const tampered = tamperJwtSignature(accessToken);
  const wrongSignature = await fetch(cardUrl, {
    headers: { Authorization: `Bearer ${tampered}` },
  });
  assert(
    wrongSignature.status === 401,
    `wrong JWT signature returned ${wrongSignature.status}, expected 401`,
  );

  const invalidClient = await fetch(oauthTokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${oauthClientId}:wrong-secret`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: oauthScope,
    }),
  });
  assert(
    invalidClient.status === 401,
    `invalid OAuth client returned ${invalidClient.status}, expected 401`,
  );
  const rpcBody = JSON.stringify({
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "GetTask",
    params: { id: "authentication-probe" },
  });
  const missingRpc = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rpcBody,
  });
  assert(
    missingRpc.status === 401,
    `missing access token on RPC returned ${missingRpc.status}, expected 401`,
  );
  const wrongRpc = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      Authorization: "Bearer not-a-jwt",
      "Content-Type": "application/json",
    },
    body: rpcBody,
  });
  assert(
    wrongRpc.status === 401,
    `malformed access token on RPC returned ${wrongRpc.status}, expected 401`,
  );
  const validRpc = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: rpcBody,
  });
  assert(
    validRpc.status === 200,
    `valid access token on RPC returned ${validRpc.status}, expected 200`,
  );
  const validRpcPayload = await validRpc.json();
  assert(
    validRpcPayload.error,
    "valid authentication probe unexpectedly found a nonexistent task",
  );

  const operatorInvokeOnly = await requestAccessToken({ scope: invokeScope });
  const operatorCannotDiscoverWithoutScope = await fetch(cardUrl, {
    headers: { Authorization: `Bearer ${operatorInvokeOnly}` },
  });
  assert(
    operatorCannotDiscoverWithoutScope.status === 403,
    `operator without discovery scope returned ${operatorCannotDiscoverWithoutScope.status}, expected 403`,
  );

  const observerToken = await requestAccessToken({
    clientId: observerClientId,
    clientSecret: observerClientSecret,
    scope: discoverScope,
  });
  const observerClaims = decodeJwtClaims(observerToken);
  assert(observerClaims.sub === observerClientId, "observer token has the wrong subject");
  assert(observerClaims.role === "observer", "observer token has the wrong role");
  const observerCard = await fetch(cardUrl, {
    headers: { Authorization: `Bearer ${observerToken}` },
  });
  assert(
    observerCard.status === 200,
    `observer discovery returned ${observerCard.status}, expected 200`,
  );
  const observerRpc = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${observerToken}`,
      "Content-Type": "application/json",
    },
    body: rpcBody,
  });
  assert(
    observerRpc.status === 403,
    `observer invocation returned ${observerRpc.status}, expected 403`,
  );

  const observerEscalation = await tokenEndpointRequest({
    clientId: observerClientId,
    clientSecret: observerClientSecret,
    scope: invokeScope,
  });
  assert(
    observerEscalation.status === 400 &&
      observerEscalation.payload?.error === "invalid_scope",
    `observer scope escalation returned ${observerEscalation.status}, expected OAuth invalid_scope`,
  );

  const deniedToken = await requestAccessToken({
    clientId: deniedClientId,
    clientSecret: deniedClientSecret,
    scope: invokeScope,
  });
  const deniedClaims = decodeJwtClaims(deniedToken);
  assert(deniedClaims.sub === deniedClientId, "denied token has the wrong subject");
  assert(deniedClaims.role === "untrusted", "denied token has the wrong role");
  const deniedRpc = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${deniedToken}`,
      "Content-Type": "application/json",
    },
    body: rpcBody,
  });
  assert(
    deniedRpc.status === 403,
    `untrusted invoker returned ${deniedRpc.status}, expected 403`,
  );

  if (managed) {
    const expiredToken = await requestAccessToken({
      clientId: "stale-client",
      clientSecret: "stale-client-secret",
    });
    assert(
      Number(decodeJwtClaims(expiredToken).exp) < Math.floor(Date.now() / 1_000),
      "stale-client token was not already expired",
    );
    const expired = await fetch(cardUrl, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert(
      expired.status === 401,
      `expired access token returned ${expired.status}, expected 401`,
    );
  }
  passed("caller identity and scope authorization");
  passed(
    managed
      ? "OAuth exchange plus missing, malformed, invalid, expired, and valid auth"
      : "OAuth exchange plus missing, malformed, invalid, and valid auth",
  );
}

function assertLogsOmitCredentials() {
  const captured = composeCapture([
    "logs",
    "--no-color",
    "agentgateway",
    "bridge",
    "reference-agent",
    "agent-a",
    "agent-b",
  ]);
  assert(captured.status === 0, "could not inspect service logs for credentials");
  for (const value of sensitiveValues()) {
    assert(!captured.output.includes(value), "a credential appeared in service logs");
  }
  passed("service logs omit tested credentials");
}

async function waitForReferenceObservation(command, predicate) {
  const deadline = Date.now() + 60_000;
  let lastValue = "";
  while (Date.now() < deadline) {
    const observation = await reference.sendAndPoll(command);
    lastValue = observation.text;
    if (observation.state.endsWith("COMPLETED") && predicate(lastValue)) {
      return lastValue;
    }
    await sleep(100);
  }
  throw new Error(
    `timed out waiting for reference observation ${command}; last value: ${lastValue}`,
  );
}

async function waitForCard(client) {
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await client.card();
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error("timed out waiting for agentgateway Agent Card", {
    cause: lastError,
  });
}

function createClient(baseUrl, target) {
  const endpoint = `${baseUrl}/a2a/${encodeURIComponent(target)}`;

  return {
    async card() {
      const accessToken = await tokenProvider.getAccessToken();
      const response = await fetch(
        `${endpoint}/.well-known/agent-card.json`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const body = await response.text();
      if (!response.ok) throw new Error(`Agent Card failed (${response.status}): ${body}`);
      return JSON.parse(body);
    },

    async rpc(method, params) {
      const accessToken = await tokenProvider.getAccessToken();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "A2A-Version": "1.0",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method,
          params,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`${method} failed (${response.status}): ${body}`);
      const payload = JSON.parse(body);
      if (payload.error) throw new Error(`${method} returned ${JSON.stringify(payload.error)}`);
      return payload;
    },

    async stream(text, contextId, options = {}) {
      const accessToken = await tokenProvider.getAccessToken();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          "A2A-Version": "1.0",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "SendStreamingMessage",
          params: {
            message: {
              messageId: randomUUID(),
              ...(contextId ? { contextId } : {}),
              role: "ROLE_USER",
              parts: [{ text }],
            },
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok || !response.body) {
        const body = await response.text();
        throw new Error(`SendStreamingMessage failed (${response.status}): ${body}`);
      }
      assert(
        response.headers.get("content-type")?.startsWith("text/event-stream"),
        `SendStreamingMessage returned ${response.headers.get("content-type")}`,
      );
      const results = [];
      for await (const envelope of parseSse(response.body)) {
        if (envelope.error) {
          throw new Error(
            `SendStreamingMessage returned ${JSON.stringify(envelope.error)}`,
          );
        }
        assert(envelope.result, "stream event contained no result");
        results.push(envelope.result);
        if (await options.stopWhen?.(envelope.result, results)) break;
      }
      return results;
    },

    async send(text, contextId) {
      const payload = await this.rpc("SendMessage", {
        message: {
          messageId: randomUUID(),
          ...(contextId ? { contextId } : {}),
          role: "ROLE_USER",
          parts: [{ text }],
        },
        configuration: { returnImmediately: true },
      });
      const task = taskFromPayload(payload);
      assert(task, "asynchronous SendMessage returned no task");
      return task;
    },

    async pollUntil(taskId, predicate) {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const payload = await this.rpc("GetTask", { id: taskId });
        const task = taskFromPayload(payload);
        assert(task, `GetTask returned no task for ${taskId}`);
        if (predicate(task)) return task;
        await sleep(100);
      }
      throw new Error(`timed out polling task ${taskId}`);
    },

    async sendAndPoll(text, contextId) {
      const initial = await this.send(text, contextId);
      let pollCount = 0;
      const terminal = isTerminal(taskState(initial))
        ? initial
        : await this.pollUntil(initial.id, (task) => {
            pollCount += 1;
            return isTerminal(taskState(task));
          });
      return {
        id: terminal.id,
        contextId: terminal.contextId,
        state: taskState(terminal),
        text: artifactText(terminal),
        statusText: messageText(terminal.status?.message),
        pollCount,
      };
    },
  };
}

function assertStreamingEvents(results, expectedText) {
  assert(results.length >= 4, "stream returned too few events");
  const task = results[0]?.task;
  assert(task?.id && task?.contextId, "stream did not begin with a task snapshot");
  assert(
    String(task.status?.state ?? "").endsWith("SUBMITTED"),
    "stream task did not begin submitted",
  );
  const statusEvents = results.filter((result) => result.statusUpdate);
  assert(
    String(statusEvents[0]?.statusUpdate?.status?.state ?? "").endsWith("WORKING"),
    "stream did not publish working status",
  );
  assert(
    String(statusEvents.at(-1)?.statusUpdate?.status?.state ?? "").endsWith(
      "COMPLETED",
    ),
    "stream did not end completed",
  );
  const artifactEvents = results
    .filter((result) => result.artifactUpdate)
    .map((result) => result.artifactUpdate);
  assert(artifactEvents.length > 0, "stream published no artifact chunks");
  const artifactIds = new Set(
    artifactEvents.map((event) => event.artifact?.artifactId),
  );
  assert(artifactIds.size === 1, "stream changed artifact IDs between chunks");
  assert(
    artifactEvents.every(
      (event, index) => Boolean(event.append) === (index > 0),
    ),
    "stream append flags were not ordered",
  );
  assert(
    artifactEvents.every(
      (event, index) => Boolean(event.lastChunk) === (index === artifactEvents.length - 1),
    ),
    "stream lastChunk flags were not terminal",
  );
  const text = artifactEvents
    .map((event) => messageText(event.artifact))
    .join("");
  assert(text === expectedText, `unexpected streamed text: ${text}`);
  const taskIndex = results.findIndex((result) => result.task);
  const firstArtifactIndex = results.findIndex((result) => result.artifactUpdate);
  const completedIndex = results.findIndex((result) =>
    String(result.statusUpdate?.status?.state ?? "").endsWith("COMPLETED"),
  );
  assert(
    taskIndex === 0 && firstArtifactIndex > taskIndex && completedIndex > firstArtifactIndex,
    "stream events were not task → artifact → completed",
  );
  assert(
    !JSON.stringify(artifactEvents).match(
      /reasoning_message|tool_call_message|tool_args|command_start|command_end/,
    ),
    "stream exposed an internal Letta event",
  );
  return { taskId: task.id, contextId: task.contextId, text };
}

async function* parseSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      while (true) {
        const boundary = buffer.match(/\r?\n\r?\n/);
        if (!boundary || boundary.index === undefined) break;
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const event = parseSseBlock(block);
        if (event) yield event;
      }
      if (done) {
        const event = parseSseBlock(buffer);
        if (event) yield event;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function parseSseBlock(block) {
  const data = block
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data ? JSON.parse(data) : undefined;
}

function taskFromPayload(payload) {
  const result = payload?.result;
  return result?.task ?? (result?.id && result?.status ? result : undefined);
}

function taskState(task) {
  return String(task?.status?.state ?? "");
}

function isTerminal(state) {
  return ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].some((suffix) =>
    state.endsWith(suffix),
  );
}

function artifactText(task) {
  return (task.artifacts ?? [])
    .flatMap((artifact) => artifact.parts ?? [])
    .map((part) => part.text ?? part.content?.value ?? "")
    .join("");
}

function messageText(message) {
  return (message?.parts ?? [])
    .map((part) => part.text ?? part.content?.value ?? "")
    .join("");
}

function compose(args, required = true) {
  const result = spawnSync(
    "docker",
    ["compose", "-p", project, ...args],
    { cwd: process.cwd(), env: composeEnv, encoding: "utf8" },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (required && result.status !== 0) {
    throw new Error(`docker compose ${args.join(" ")} failed with ${result.status}`);
  }
  return result.status;
}

function composeCapture(args) {
  const result = spawnSync(
    "docker",
    ["compose", "-p", project, ...args],
    { cwd: process.cwd(), env: composeEnv, encoding: "utf8" },
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function sensitiveValues() {
  return [
    oauthClientSecret,
    observerClientSecret,
    deniedClientSecret,
    bridgeClientSecret,
    referenceClientSecret,
    "wrong-secret",
    "stale-client-secret",
    ...issuedTokens,
    composeEnv.OPENAI_API_KEY,
    composeEnv.LETTA_APP_SERVER_TOKEN ?? "a2a-lab-app-server-token",
  ].filter((value) => typeof value === "string" && value.length >= 4);
}

function createTokenProvider({
  tokenUrl,
  clientId,
  clientSecret,
  scope,
  refreshSkewMs,
}) {
  let cached;
  let exchangeInFlight;
  return {
    async getAccessToken() {
      if (cached && cached.expiresAt > Date.now() + refreshSkewMs) {
        return cached.value;
      }
      if (!exchangeInFlight) {
        exchangeInFlight = requestAccessToken({
          tokenUrl,
          clientId,
          clientSecret,
          scope,
        }).then((value) => {
          const claims = decodeJwtClaims(value);
          cached = { value, expiresAt: Number(claims.exp) * 1_000 };
          return value;
        }).finally(() => {
          exchangeInFlight = undefined;
        });
      }
      return exchangeInFlight;
    },
  };
}

async function requestAccessToken({
  tokenUrl = oauthTokenUrl,
  clientId = oauthClientId,
  clientSecret = oauthClientSecret,
  scope = oauthScope,
} = {}) {
  const { response, payload } = await tokenEndpointRequest({
    tokenUrl,
    clientId,
    clientSecret,
    scope,
  });
  if (!response.ok) {
    const code = typeof payload?.error === "string" ? `: ${payload.error}` : "";
    throw new Error(`OAuth token exchange failed (${response.status})${code}`);
  }
  assert(typeof payload.access_token === "string", "OAuth response has no access token");
  issuedTokens.add(payload.access_token);
  return payload.access_token;
}

async function tokenEndpointRequest({
  tokenUrl = oauthTokenUrl,
  clientId = oauthClientId,
  clientSecret = oauthClientSecret,
  scope = oauthScope,
} = {}) {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    if (!response.ok) {
      throw new Error(`OAuth token exchange failed (${response.status})`);
    }
    throw new Error("OAuth token endpoint returned a non-JSON response");
  }
  return { response, status: response.status, payload };
}

function decodeJwtClaims(token) {
  const parts = token.split(".");
  assert(parts.length === 3, "access token is not a compact JWT");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

function tamperJwtSignature(token) {
  const parts = token.split(".");
  const first = parts[2][0];
  parts[2] = `${first === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  return parts.join(".");
}

function redactCredentials(text) {
  return sensitiveValues().reduce(
    (redacted, value) => redacted.split(value).join("<redacted>"),
    text,
  );
}

function passed(label) {
  console.log(`✓ ${label}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("failed to allocate an integration port"));
        else resolve(String(port));
      });
    });
  });
}
