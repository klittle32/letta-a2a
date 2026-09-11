import { appendFileSync } from "node:fs";
import {
  CancelTaskRequest,
  GetTaskRequest,
  Role,
  SendMessageRequest,
  TaskState,
} from "@a2a-js/sdk";
import { ServerCallContext } from "@a2a-js/sdk/server";
import type { LettaAgentClient } from "@letta-ai/letta-agent-sdk";
import { DurableBinding } from "../../src/durable-binding.js";
import { createBridge } from "../../src/bridge.js";

const [directory, counter, phase, action = "crash", savedTaskId = ""] =
  process.argv.slice(2);
if (!directory || !counter || !phase)
  throw new Error("Missing crash worker arguments");
const state = await DurableBinding.open({
  directory,
  bindingId: "crash-fixture",
});
let taskId = savedTaskId;
let queuedTaskId = "";
let sessionsOpened = 0;
let firstSent!: () => void;
const firstSentPromise = new Promise<void>((resolve) => {
  firstSent = resolve;
});
let queuedDispatched!: () => void;
const queuedDispatchedPromise = new Promise<void>((resolve) => {
  queuedDispatched = resolve;
});
if (phase === "queued" && savedTaskId)
  [taskId, queuedTaskId] = JSON.parse(savedTaskId);
const context = () => new ServerCallContext({ requestedVersion: "1.0" });
const request = (
  messageId = "original-message",
  contextId = "original-context",
) =>
  SendMessageRequest.fromJSON({
    message: {
      messageId,
      contextId,
      role: Role.ROLE_USER,
      parts: [{ text: "harmless fake turn" }],
    },
  });

async function checkpoint(data: Record<string, unknown> = {}): Promise<never> {
  // Parent must SIGKILL us here; no finally/disposal or graceful owner release.
  process.stdout.write(
    JSON.stringify({ checkpoint: true, phase, action, taskId, ...data }) + "\n",
  );
  setInterval(() => {}, 1000);
  return await new Promise<never>(() => {});
}

if (action === "crash") {
  const accept = state.accept.bind(state);
  state.accept = async (...args) => {
    await accept(...args);
    if (
      phase === "queued" &&
      args[0].userMessage.messageId === "queued-message"
    )
      queuedTaskId = args[0].taskId;
    else taskId = args[0].taskId;
    if (phase === "accepted") await checkpoint();
  };
  const dispatched = state.dispatched.bind(state);
  state.dispatched = async (...args) => {
    await dispatched(...args);
    if (
      phase === "queued" &&
      args[0].userMessage.messageId === "queued-message"
    )
      queuedDispatched();
  };
  const beforeSend = state.execution.beforeSend!;
  state.execution.beforeSend = async (...args) => {
    await beforeSend(...args);
    if (phase === "intent") await checkpoint();
  };
  const sent = state.execution.sent!;
  state.execution.sent = async (...args) => {
    await sent(...args);
    if (phase === "sent") await checkpoint();
  };
  const observe = state.execution.observe!;
  state.execution.observe = async (...args) => {
    await observe(...args);
    if (phase === "result" && args[1].type === "result") await checkpoint();
  };
  const stopped = state.execution.stopped!;
  state.execution.stopped = async (...args) => {
    await stopped(...args);
    if (phase === "stopped") await checkpoint();
  };
  const publication = state.publication.bind(state);
  state.publication = async (...args) => {
    await publication(...args);
    if (phase === "publication") await checkpoint();
  };
}

const open = () => ({
  async ready() {
    sessionsOpened++;
    return { conversationId: "fake-conversation" };
  },
  async send() {
    appendFileSync(counter!, "sdk-send\n");
    firstSent();
  },
  async abort() {},
  async *stream() {
    if (phase === "queued" && action === "crash")
      await new Promise<void>(() => {});
    yield { type: "assistant" as const, content: "durable answer" };
    yield {
      type: "result" as const,
      success: true,
      durationMs: 1,
      result: "durable answer",
      stopReason: "end_turn",
      runIds: ["fake-run"],
    };
  },
  async [Symbol.asyncDispose]() {},
});
const client = {
  createSession: open,
  resumeSession: open,
} as unknown as LettaAgentClient;
const bridge = createBridge({
  sharingDomain: "test",
  publicBaseUrl: "http://localhost",
  durability: state,
  ...(phase === "interrupted"
    ? {
        // Explicit trusted application interruption, not ambiguous SDK interrupted.
        runner: {
          async runTurn() {
            appendFileSync(counter!, "trusted-runner\n");
            return { text: "need input", state: "input_required" as const };
          },
        },
      }
    : { client, agentId: "agent", sessionOptions: {} }),
});

if (phase === "queued") {
  if (action === "crash") {
    const unexpected = (error: unknown) => {
      console.error(error);
      process.exit(1);
    };
    void bridge.requestHandler
      .sendMessage(request(), context())
      .catch(unexpected);
    await firstSentPromise;
    void bridge.requestHandler
      .sendMessage(request("queued-message"), context())
      .catch(unexpected);
    await queuedDispatchedPromise;
    // Let executeTurn enter runTurn and wait on the first turn's context lock.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const active = await bridge.requestHandler.getTask(
      GetTaskRequest.fromJSON({ id: taskId }),
      context(),
    );
    const queued = await bridge.requestHandler.getTask(
      GetTaskRequest.fromJSON({ id: queuedTaskId }),
      context(),
    );
    await checkpoint({
      queuedTaskId,
      sessionsOpened,
      statuses: [active.status?.state, queued.status?.state],
    });
  } else {
    const tasks = await Promise.all(
      [taskId, queuedTaskId].map((id) =>
        bridge.requestHandler.getTask(
          GetTaskRequest.fromJSON({ id }),
          context(),
        ),
      ),
    );
    const rejections: boolean[] = [];
    for (const id of ["original-message", "queued-message", "next-message"]) {
      try {
        await bridge.requestHandler.sendMessage(request(id), context());
        rejections.push(false);
      } catch {
        rejections.push(true);
      }
    }
    await checkpoint({
      queuedTaskId,
      statuses: tasks.map((task) => task.status?.state),
      rejections,
      unresolved: state
        .inspectRecovery()
        .map((r) => ({
          taskId: r.taskId,
          phase: r.phase,
          sendReturned: r.sendReturned,
        })),
      sessionsOpened,
    });
  }
} else if (action === "crash") {
  const result = await bridge.requestHandler.sendMessage(request(), context());
  if (!("id" in result)) throw new Error("Expected task response");
  taskId = result.id;
  if (phase !== "completed" && phase !== "interrupted") {
    throw new Error(
      `Crash boundary ${phase} was never reached (durability wiring missing?)`,
    );
  }
  await checkpoint({ status: result.status?.state });
} else {
  let cancellationRejected: boolean | undefined;
  let cancellationState: TaskState | undefined;
  if (action === "cancel") {
    try {
      const canceled = await bridge.requestHandler.cancelTask(
        CancelTaskRequest.fromJSON({ id: taskId }),
        context(),
      );
      cancellationState = canceled.status?.state;
      cancellationRejected = false;
    } catch {
      cancellationRejected = true;
    }
  }
  const task = await bridge.requestHandler.getTask(
    GetTaskRequest.fromJSON({ id: taskId }),
    context(),
  );
  let duplicateRejected = false;
  try {
    await bridge.requestHandler.sendMessage(request(), context());
  } catch {
    duplicateRejected = true;
  }
  const unresolved = state.inspectRecovery();
  let nextContextRejected: boolean | undefined;
  if (unresolved.length) {
    try {
      await bridge.requestHandler.sendMessage(
        request("next-message"),
        context(),
      );
      nextContextRejected = false;
    } catch {
      nextContextRejected = true;
    }
  }
  const subscription = bridge.requestHandler.resubscribe(
    { id: taskId, tenant: "" },
    context(),
  );
  let subscriptionRejected = false;
  let subscriptionSnapshot = false;
  let subscriptionEnded = false;
  try {
    const first = await subscription.next();
    subscriptionSnapshot = first.value?.payload?.$case === "task";
    const second = await subscription.next();
    subscriptionEnded = second.done === true;
  } catch {
    subscriptionRejected = true;
  } finally {
    await subscription.return();
  }

  let pruned: number | undefined;
  let prunedTaskMissing: boolean | undefined;
  let tombstoneRejected: boolean | undefined;
  if (action === "prune") {
    pruned = await state.prune(Date.now() + 10000);
    if (pruned) {
      try {
        await bridge.requestHandler.getTask(
          GetTaskRequest.fromJSON({ id: taskId }),
          context(),
        );
        prunedTaskMissing = false;
      } catch {
        prunedTaskMissing = true;
      }
      try {
        await bridge.requestHandler.sendMessage(request(), context());
        tombstoneRejected = false;
      } catch {
        tombstoneRejected = true;
      }
    }
  }
  await checkpoint({
    status: task.status?.state,
    artifacts: task.artifacts,
    history: task.history,
    detail: task.status?.message,
    unresolved: unresolved.map((r) => ({
      phase: r.phase,
      otid: r.otid,
      conversationId: r.conversationId,
      sendReturned: r.sendReturned,
      cancelRequested: r.cancelRequested,
    })),
    cancellationRejected,
    cancellationState,
    duplicateRejected,
    nextContextRejected,
    subscriptionRejected,
    subscriptionSnapshot,
    subscriptionEnded,
    pruned,
    prunedTaskMissing,
    tombstoneRejected,
  });
}
