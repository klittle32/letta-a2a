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
const agentAPort =
  process.env.A2A_INTEGRATION_AGENT_A_PORT ??
  (managed ? await findFreePort() : "4001");
const referencePort =
  process.env.A2A_INTEGRATION_REFERENCE_PORT ??
  (managed ? await findFreePort() : "4003");
const apiKey = process.env.LITELLM_MASTER_KEY ?? "sk-a2a-lab-only";
const composeEnv = {
  ...process.env,
  LITELLM_A_PORT: agentAPort,
  LITELLM_B_PORT:
    process.env.A2A_INTEGRATION_AGENT_B_PORT ??
    (managed ? await findFreePort() : "4002"),
  LITELLM_REFERENCE_PORT: referencePort,
  ...(!liveLetta && !process.env.OPENAI_API_KEY
    ? { OPENAI_API_KEY: "sk-unused-reference-only" }
    : {}),
};
const agentA = createClient(`http://127.0.0.1:${agentAPort}`, "agent-a");
const reference = createClient(
  `http://127.0.0.1:${referencePort}`,
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
      "litellm-reference",
      ...(liveLetta ? ["litellm-a"] : []),
    ]);
  }

  await runChecks();
} catch (error) {
  failure = error;
  if (managed) {
    compose(["logs", "--no-color", "--tail", "200"], false);
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
  const card = await reference.card();
  assert(card.name === "Independent Reference Agent", "unexpected Agent Card name");
  assert(
    card.protocolVersion === "1.0" ||
      card.supportedInterfaces?.some(
        (item) => item.protocolVersion === "1.0",
      ),
    "reference Agent Card does not advertise A2A 1.0",
  );
  passed("Agent Card discovery through LiteLLM");

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
