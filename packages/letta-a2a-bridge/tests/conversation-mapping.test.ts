import { expect, test } from "bun:test";
import type { LettaAgentClient } from "@letta-ai/letta-agent-sdk";
import { AgentSdkTurnRunner, type SessionPolicy } from "../src/index.js";

function fixture(mapping: SessionPolicy["conversationMapping"]) {
  const events: string[] = [];
  const open = (id: string) => {
    events.push(id);
    return {
      async ready() {
        return { conversationId: "conv-new" };
      },
      async send() {
        events.push("send");
      },
      async abort() {},
      async *stream() {
        yield { type: "result", success: true, result: "done" };
      },
      async [Symbol.asyncDispose]() {
        events.push("disposed");
      },
    };
  };
  const runner = new AgentSdkTurnRunner(
    { createSession: open, resumeSession: open } as unknown as LettaAgentClient,
    "agent",
    {
      sharingDomain: "test",
      sessionOptions: {},
      conversationMapping: mapping,
    },
  );
  const run = () =>
    runner.runTurn({
      a2aContextId: "owned",
      messageId: "message",
      text: "hi",
      signal: new AbortController().signal,
      onAssistantText() {},
    });
  return { events, run, runner };
}

test("loads idle continuity and persists readiness before send", async () => {
  const saved: string[][] = [];
  const { events, run } = fixture({
    get: () => "conv-saved",
    set: (key, id) => {
      saved.push([key, id]);
    },
  });
  await run();
  expect(events).toEqual(["conv-saved", "send", "disposed"]);
  expect(saved).toEqual([["owned", "conv-new"]]);
});

test("mapping read failure fails closed before opening a session", async () => {
  const { events, run } = fixture({
    get() {
      throw new Error("read failed");
    },
    set() {},
  });
  await expect(run()).rejects.toThrow("read failed");
  expect(events).toEqual([]);
});

test("mapping write failure disposes without sending or caching failed mapping", async () => {
  const { events, run } = fixture({
    get: () => undefined,
    set() {
      throw new Error("write failed");
    },
  });
  await expect(run()).rejects.toThrow("write failed");
  await expect(run()).rejects.toThrow("write failed");
  expect(events).toEqual(["agent", "disposed", "agent", "disposed"]);
});

test("mapping writes retain the execution lock until persistence settles", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  const { events, run } = fixture({
    get: () => undefined,
    async set() {
      if (++writes === 1) await gate;
    },
  });
  const first = run();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = run();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(events).toEqual(["agent"]);
  release();
  await Promise.all([first, second]);
  expect(events).toEqual([
    "agent",
    "send",
    "disposed",
    "conv-new",
    "send",
    "disposed",
  ]);
});
