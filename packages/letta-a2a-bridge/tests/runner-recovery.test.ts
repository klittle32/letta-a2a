import { expect, test } from "bun:test";
import type { LettaAgentClient, SDKMessage } from "@letta-ai/letta-agent-sdk";
import {
  AgentSdkTurnRunner,
  LettaTurnCancelledError,
  type SessionPolicy,
} from "../src/letta-agent.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(execution: SessionPolicy["execution"] = {}, failure?: string) {
  const events: string[] = [];
  let opened = 0;
  let sends = 0;
  const result: SDKMessage = {
    type: "result",
    success: true,
    durationMs: 1,
    result: "done",
    conversationId: "conversation",
  };
  const open = () => {
    opened++;
    return {
      async ready() {
        return { conversationId: "conversation" };
      },
      async send() {
        sends++;
        events.push("send");
        if (failure === "transport") throw new Error(failure);
      },
      async abort() {},
      async *stream() {
        if (failure === "stream") throw new Error(failure);
        if (failure === "missing") return;
        yield failure === "interrupted"
          ? { ...result, stopReason: "interrupted" }
          : result;
      },
      async [Symbol.asyncDispose]() {
        events.push("dispose");
        if (failure === "dispose") throw new Error(failure);
      },
    };
  };
  const runner = new AgentSdkTurnRunner(
    { createSession: open, resumeSession: open } as unknown as Pick<
      LettaAgentClient,
      "createSession" | "resumeSession"
    >,
    "agent",
    {
      sharingDomain: "test",
      conversationMapping: {
        get() {
          return undefined;
        },
        set() {
          events.push("mapping");
        },
      },
      sessionOptions: () => ({
        options: {},
        async close() {
          events.push("close");
          if (failure === "close") throw new Error(failure);
        },
      }),
      execution,
    },
  );
  const run = (signal = new AbortController().signal) =>
    runner.runTurn({
      taskId: "task",
      a2aContextId: "context",
      messageId: "otid",
      text: "hello",
      signal,
      onAssistantText() {},
    });
  return {
    runner,
    run,
    events,
    result,
    opened: () => opened,
    sends: () => sends,
  };
}

test("durable guard prevents session setup", async () => {
  const f = fixture({
    beforeTurn() {
      throw new Error("guard");
    },
  });
  await expect(f.run()).rejects.toThrow("guard");
  expect(f.opened()).toBe(0);
});

test("beforeSend sees saved ready correlation and write failure prevents input", async () => {
  const f = fixture({
    beforeSend(request, correlation) {
      expect(request.taskId).toBe("task");
      expect(correlation).toEqual({
        agentId: "agent",
        conversationId: "conversation",
        otid: "otid",
      });
      expect(f.events).toEqual(["mapping"]);
      throw new Error("write failed");
    },
  });
  await expect(f.run()).rejects.toThrow("write failed");
  expect(f.sends()).toBe(0);
  expect(f.runner.unresolvedContexts).toEqual([]);
});

test("sent is only an awaited observation; stopped follows observations and cleanup under lock", async () => {
  const sent = deferred();
  const sentEntered = deferred();
  const stopped = deferred();
  const stoppedEntered = deferred();
  const f = fixture({
    async sent() {
      f.events.push("sent");
      sentEntered.resolve();
      await sent.promise;
    },
    observe(_request, message) {
      expect(message).toBe(f.result);
      f.events.push("observe");
    },
    async stopped() {
      f.events.push("stopped");
      stoppedEntered.resolve();
      await stopped.promise;
    },
  });
  const first = f.run();
  await sentEntered.promise;
  expect(f.events).toEqual(["mapping", "send", "sent"]);
  sent.resolve();
  await stoppedEntered.promise;
  expect(f.events).toEqual([
    "mapping",
    "send",
    "sent",
    "observe",
    "dispose",
    "close",
    "stopped",
  ]);
  const second = f.run();
  await Promise.resolve();
  expect(f.opened()).toBe(1);
  stopped.resolve();
  expect(await first).toEqual({ text: "done" });
  await second;
  expect(f.opened()).toBe(2);
});

for (const failure of [
  "transport",
  "stream",
  "missing",
  "dispose",
  "close",
  "observe",
  "sent",
  "stopped",
  "interrupted",
]) {
  test(`${failure} after send persists unresolved and blocks another submission`, async () => {
    let unresolved = 0;
    const fail = () => {
      throw new Error(failure);
    };
    const f = fixture(
      {
        ...(failure === "observe" ? { observe: fail } : {}),
        ...(failure === "sent" ? { sent: fail } : {}),
        ...(failure === "stopped" ? { stopped: fail } : {}),
        unresolved() {
          unresolved++;
        },
      },
      failure,
    );
    const error = await f.run().catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(LettaTurnCancelledError);
    expect(unresolved).toBe(1);
    expect(f.runner.unresolvedContexts).toEqual(["context"]);
    await expect(f.run()).rejects.toThrow("reconciliation");
    expect(f.sends()).toBe(1);
  });
}

test("unresolved persistence failure cannot clear local quarantine", async () => {
  const f = fixture(
    {
      unresolved() {
        throw new Error("journal unavailable");
      },
    },
    "transport",
  );
  await expect(f.run()).rejects.toThrow();
  expect(f.runner.unresolvedContexts).toEqual(["context"]);
  await expect(f.run()).rejects.toThrow("reconciliation");
  expect(f.sends()).toBe(1);
});

test("unresolved hook is awaited before rejecting the turn", async () => {
  const entered = deferred();
  const release = deferred();
  let settled = false;
  const f = fixture(
    {
      async unresolved() {
        entered.resolve();
        await release.promise;
      },
    },
    "transport",
  );
  const turn = f.run().catch(() => {
    settled = true;
  });
  await entered.promise;
  expect(f.runner.unresolvedContexts).toEqual(["context"]);
  expect(settled).toBe(false);
  release.resolve();
  await turn;
  expect(settled).toBe(true);
});

test("observation persistence is awaited before cleanup and stopped", async () => {
  const entered = deferred();
  const release = deferred();
  const f = fixture({
    async observe() {
      entered.resolve();
      await release.promise;
    },
    stopped() {
      f.events.push("stopped");
    },
  });
  const turn = f.run();
  await entered.promise;
  expect(f.events).toEqual(["mapping", "send"]);
  release.resolve();
  await turn;
  expect(f.events).toEqual(["mapping", "send", "dispose", "close", "stopped"]);
});

test("cancellation during beforeSend remains safely pre-send", async () => {
  const controller = new AbortController();
  const f = fixture({
    beforeSend() {
      controller.abort();
    },
  });
  await expect(f.run(controller.signal)).rejects.toBeInstanceOf(
    LettaTurnCancelledError,
  );
  expect(f.sends()).toBe(0);
  expect(f.runner.unresolvedContexts).toEqual([]);
});
