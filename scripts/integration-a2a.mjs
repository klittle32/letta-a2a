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
const apiKey = process.env.A2A_GATEWAY_KEY ?? "sk-a2a-lab-only";
const composeEnv = {
  ...process.env,
  A2A_GATEWAY_PORT: gatewayPort,
  A2A_GATEWAY_UI_PORT: gatewayUiPort,
  A2A_GATEWAY_KEY: apiKey,
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
  const bearer = card.securitySchemes?.a2aLabBearer?.httpAuthSecurityScheme;
  assert(bearer?.scheme === "Bearer", `${target} Agent Card lost Bearer security`);
  assert(
    card.securityRequirements?.some(
      (requirement) => requirement.schemes?.a2aLabBearer,
    ),
    `${target} Agent Card does not require the advertised Bearer scheme`,
  );
  assert(
    !JSON.stringify(card).includes(apiKey),
    `${target} Agent Card exposed the gateway credential`,
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
    `missing gateway key returned ${missing.status}, expected 401`,
  );
  const wrong = await fetch(cardUrl, {
    headers: { Authorization: "Bearer wrong-a2a-lab-key" },
  });
  assert(
    wrong.status === 401,
    `incorrect gateway key returned ${wrong.status}, expected 401`,
  );
  const valid = await fetch(cardUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  assert(
    valid.status === 200,
    `valid gateway key returned ${valid.status}, expected 200`,
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
    `missing gateway key on RPC returned ${missingRpc.status}, expected 401`,
  );
  const wrongRpc = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      Authorization: "Bearer wrong-a2a-lab-key",
      "Content-Type": "application/json",
    },
    body: rpcBody,
  });
  assert(
    wrongRpc.status === 401,
    `incorrect gateway key on RPC returned ${wrongRpc.status}, expected 401`,
  );
  const validRpc = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: rpcBody,
  });
  assert(
    validRpc.status === 200,
    `valid gateway key on RPC returned ${validRpc.status}, expected 200`,
  );
  const validRpcPayload = await validRpc.json();
  assert(
    validRpcPayload.error,
    "valid authentication probe unexpectedly found a nonexistent task",
  );
  passed("missing, incorrect, and valid gateway authentication");
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
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "A2A-Version": "1.0",
  };

  return {
    async card() {
      const response = await fetch(
        `${endpoint}/.well-known/agent-card.json`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      const body = await response.text();
      if (!response.ok) throw new Error(`Agent Card failed (${response.status}): ${body}`);
      return JSON.parse(body);
    },

    async rpc(method, params) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
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
    apiKey,
    "wrong-a2a-lab-key",
    composeEnv.OPENAI_API_KEY,
    composeEnv.LETTA_APP_SERVER_TOKEN ?? "a2a-lab-app-server-token",
  ].filter((value) => typeof value === "string" && value.length >= 4);
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
