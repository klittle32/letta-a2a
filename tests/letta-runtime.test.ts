import { describe, expect, test } from "bun:test";

import {
  LettaRuntime,
  LettaTurnCancelledError,
} from "../services/bridge/src/letta-runtime.js";

describe("LettaRuntime cancellation", () => {
  test("cancels a task while it is queued on a conversation lock", async () => {
    const runtime = new LettaRuntime(
      {
        key: "agent-a",
        displayName: "Agent A",
        appServerUrl: "ws://agent-a/ws",
        appServerToken: "token",
      },
      null as never,
      "test-model",
      30_000,
      {},
      { getAccessToken: async () => "oauth-access-token" },
      1,
    );

    const entered: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    (runtime as any).runTurnUnlocked = async (options: {
      a2aTaskId: string;
    }) => {
      entered.push(options.a2aTaskId);
      if (options.a2aTaskId === "task-1") await firstGate;
      return options.a2aTaskId;
    };

    const first = runtime.runTurn(turn("task-1"));
    await waitUntil(() => entered.includes("task-1"));
    const queued = runtime.runTurn(turn("task-2"));
    const queuedOutcome = queued.then(
      (value) => value,
      (error) => error,
    );

    await runtime.cancelTask("task-2");
    expect(await queuedOutcome).toBeInstanceOf(LettaTurnCancelledError);
    expect(entered).toEqual(["task-1"]);

    releaseFirst();
    await expect(first).resolves.toBe("task-1");
    runtime.claimTerminal("task-1", "completed");
    runtime.claimTerminal("task-2", "canceled");
  });

  test("uses one atomic winner for cancellation versus completion", async () => {
    const runtime = createRuntime();
    (runtime as any).runTurnUnlocked = async () => "done";

    await expect(runtime.runTurn(turn("cancel-wins"))).resolves.toBe("done");
    await runtime.cancelTask("cancel-wins");
    expect(runtime.claimTerminal("cancel-wins", "completed")).toBe("canceled");

    await expect(runtime.runTurn(turn("complete-wins"))).resolves.toBe("done");
    expect(runtime.claimTerminal("complete-wins", "completed")).toBe(
      "completed",
    );
    await runtime.cancelTask("complete-wins");
    expect(runtime.claimTerminal("complete-wins", "failed")).toBe(
      "completed",
    );
    expect(runtime.claimTerminal("complete-wins", "canceled")).toBe(
      "completed",
    );
  });

  test("holds the conversation lock until an aborted runtime terminates", async () => {
    const runtime = createRuntime();
    const runtimeScope = {
      agent_id: "agent-id",
      conversation_id: "conversation-id",
    };
    const handlers = new Set<(message: any) => void>();
    let runtimeStarts = 0;
    const client = {
      runtimeStart: async () => {
        runtimeStarts += 1;
        return { success: true, runtime: runtimeScope };
      },
      onMessage: (handler: (message: any) => void) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      submitInput: async () => ({ accepted: true }),
      abort: async () => ({ aborted: true }),
    };
    (runtime as any).client = client;
    (runtime as any).agentId = "agent-id";
    (runtime as any).contextStore = {
      get: () => "conversation-id",
      save: () => undefined,
    };

    const first = runtime.runTurn(turn("task-1"));
    const firstOutcome = first.then(
      (value) => value,
      (error) => error,
    );
    await waitUntil(() => runtimeStarts === 1);
    await runtime.cancelTask("task-1");

    const second = runtime.runTurn(turn("task-2"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtimeStarts).toBe(1);

    emit(handlers, { type: "turn_finished", runtime: runtimeScope });
    expect(await firstOutcome).toBeInstanceOf(LettaTurnCancelledError);
    runtime.claimTerminal("task-1", "canceled");

    await waitUntil(() => runtimeStarts === 2);
    emit(handlers, { type: "turn_finished", runtime: runtimeScope });
    await expect(second).resolves.toBe("");
    runtime.claimTerminal("task-2", "completed");
  });

  test("emits only top-level assistant text as public output chunks", async () => {
    const runtime = createRuntime();
    const runtimeScope = {
      agent_id: "agent-id",
      conversation_id: "conversation-id",
    };
    const handlers = new Set<(message: any) => void>();
    (runtime as any).client = {
      runtimeStart: async () => ({ success: true, runtime: runtimeScope }),
      onMessage: (handler: (message: any) => void) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      submitInput: async () => ({ accepted: true }),
      abort: async () => ({ aborted: true }),
    };
    (runtime as any).agentId = "agent-id";
    (runtime as any).contextStore = {
      get: () => "conversation-id",
      save: () => undefined,
    };
    const chunks: string[] = [];
    const outcome = runtime.runTurn({
      ...turn("stream-task"),
      onAssistantDelta: (text) => chunks.push(text),
    });
    await waitUntil(() => handlers.size === 1);

    emit(handlers, streamDelta(runtimeScope, "reasoning_message", "PRIVATE_REASONING"));
    emit(handlers, {
      ...streamDelta(runtimeScope, "assistant_message", "PRIVATE_SUBAGENT"),
      subagent_id: "subagent-1",
    });
    const nestedSubagent = streamDelta(
      runtimeScope,
      "assistant_message",
      "PRIVATE_NESTED_SUBAGENT",
    );
    (nestedSubagent.delta as Record<string, unknown>).subagent_id = "subagent-2";
    emit(handlers, nestedSubagent);
    emit(handlers, {
      type: "stream_delta",
      runtime: runtimeScope,
      delta: {
        message_type: "client_tool_start",
        tool_args: "PRIVATE_TOOL_ARGUMENTS",
      },
    });
    emit(
      handlers,
      streamDelta(runtimeScope, "tool_return_message", "PRIVATE_TOOL_RESULT"),
    );
    emit(handlers, {
      type: "stream_delta",
      runtime: runtimeScope,
      delta: {
        message_type: "command_end",
        input: "PRIVATE_COMMAND_INPUT",
        output: "PRIVATE_COMMAND_OUTPUT",
      },
    });
    emit(
      handlers,
      streamDelta(runtimeScope, "future_private_event", "PRIVATE_UNKNOWN"),
    );
    emit(handlers, streamDelta(runtimeScope, "assistant_message", "  SAFE_ "));
    emit(handlers, streamDelta(runtimeScope, "assistant_message", "STREAM  "));
    emit(handlers, { type: "turn_finished", runtime: runtimeScope });

    await expect(outcome).resolves.toBe("SAFE_ STREAM");
    expect(chunks).toEqual(["SAFE_", " STREAM"]);
    expect(JSON.stringify(chunks)).not.toContain("PRIVATE_");
  });
});

function createRuntime(): LettaRuntime {
  return new LettaRuntime(
    {
      key: "agent-a",
      displayName: "Agent A",
      appServerUrl: "ws://agent-a/ws",
      appServerToken: "token",
    },
    null as never,
    "test-model",
    30_000,
    {},
    { getAccessToken: async () => "oauth-access-token" },
    1,
  );
}

function turn(a2aTaskId: string) {
  return {
    a2aContextId: "shared-context",
    a2aTaskId,
    messageId: `message-${a2aTaskId}`,
    text: "hello",
    hop: 0,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition was not reached");
}

function emit(
  handlers: Set<(message: any) => void>,
  message: Record<string, unknown>,
): void {
  for (const handler of [...handlers]) handler(message);
}

function streamDelta(
  runtime: Record<string, string>,
  messageType: string,
  content: string,
): Record<string, unknown> {
  return {
    type: "stream_delta",
    runtime,
    delta: {
      type: "message",
      message_type: messageType,
      content,
    },
  };
}
