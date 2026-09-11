import { describe, expect, test } from "bun:test";

import type {
  A2AInvocation,
  A2AInvocationResult,
  A2AInvoker,
} from "../src/a2a-invoker.js";
import type { ContextStore } from "../src/context-store.js";
import { A2AToolService } from "../src/tool-service.js";

class MemoryContextStore implements ContextStore {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async set(key: string, contextId: string): Promise<void> {
    this.values.set(key, contextId);
  }
}

class RecordingInvoker implements A2AInvoker {
  readonly calls: A2AInvocation[] = [];

  async invoke(input: A2AInvocation): Promise<A2AInvocationResult> {
    this.calls.push(input);
    return {
      ok: true,
      status: "completed",
      taskId: `task-${this.calls.length}`,
      contextId: input.contextId ?? "remote-context-1",
      text: "remote answer",
    };
  }
}

describe("A2AToolService", () => {
  test("reuses the remote context for the same local conversation and target", async () => {
    const invoker = new RecordingInvoker();
    const contexts = new MemoryContextStore();
    const service = new A2AToolService(
      { peer: "http://127.0.0.1:41241" },
      invoker,
      contexts,
    );

    await service.invoke({
      target: "peer",
      message: "first",
      localScope: "agent-a/conversation-a",
      signal: new AbortController().signal,
    });
    await service.invoke({
      target: "peer",
      message: "follow-up",
      localScope: "agent-a/conversation-a",
      signal: new AbortController().signal,
    });

    expect(invoker.calls.map((call) => call.contextId)).toEqual([
      undefined,
      "remote-context-1",
    ]);
  });

  test("newContext bypasses the saved context and replaces it", async () => {
    const invoker = new RecordingInvoker();
    const contexts = new MemoryContextStore();
    await contexts.set("agent-a/conversation-a/peer", "old-context");
    const service = new A2AToolService(
      { peer: "http://127.0.0.1:41241" },
      invoker,
      contexts,
    );

    await service.invoke({
      target: "peer",
      message: "start over",
      localScope: "agent-a/conversation-a",
      newContext: true,
      signal: new AbortController().signal,
    });

    expect(invoker.calls[0]?.contextId).toBeUndefined();
    expect(await contexts.get("agent-a/conversation-a/peer")).toBe(
      "remote-context-1",
    );
  });

  test("rejects unknown targets before making a network request", async () => {
    const invoker = new RecordingInvoker();
    const service = new A2AToolService(
      { peer: "http://127.0.0.1:41241" },
      invoker,
      new MemoryContextStore(),
    );

    await expect(
      service.invoke({
        target: "missing",
        message: "hello",
        localScope: "agent-a/conversation-a",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('Unknown A2A target "missing"');
    expect(invoker.calls).toHaveLength(0);
  });

  test("cancels a call while it waits for the same remote context", async () => {
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const invoker: A2AInvoker = {
      async invoke(input) {
        calls += 1;
        if (calls === 1) await firstCanFinish;
        return {
          ok: true,
          status: "completed",
          contextId: input.contextId ?? "remote-context-1",
          text: "done",
        };
      },
    };
    const service = new A2AToolService(
      { peer: "http://127.0.0.1:41241" },
      invoker,
      new MemoryContextStore(),
    );
    const first = service.invoke({
      target: "peer",
      message: "first",
      localScope: "agent-a/conversation-a",
      signal: new AbortController().signal,
    });
    const cancellation = new AbortController();
    const second = service.invoke({
      target: "peer",
      message: "second",
      localScope: "agent-a/conversation-a",
      signal: cancellation.signal,
    });
    cancellation.abort();

    await expect(second).rejects.toThrow("A2A invocation was cancelled");
    expect(calls).toBe(1);

    const third = service.invoke({
      target: "peer",
      message: "third",
      localScope: "agent-a/conversation-a",
      signal: new AbortController().signal,
    });
    await Bun.sleep(1);
    expect(calls).toBe(1);

    releaseFirst();
    await Promise.all([first, third]);
    expect(calls).toBe(2);
  });
});
