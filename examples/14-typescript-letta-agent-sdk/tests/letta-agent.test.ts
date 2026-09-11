import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import type { LettaAgentClient } from "@letta-ai/letta-agent-sdk";

import { AgentSdkTurnRunner, LettaTurnCancelledError } from "letta-a2a-bridge";
import { createA2ASessionOptions } from "../src/tool-policy.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeSession {
  readonly started = deferred();
  readonly finish = deferred();
  readonly disposing = deferred();
  readonly close = deferred();
  aborted = false;
  disposed = false;

  constructor(
    readonly conversationId: string,
    holdClose = false,
  ) {
    if (!holdClose) this.close.resolve();
  }

  async ready() {
    return { conversationId: this.conversationId };
  }
  async send() {
    this.started.resolve();
  }
  async abort() {
    this.aborted = true;
  }
  async *stream() {
    await this.finish.promise;
    yield {
      type: "result" as const,
      success: true,
      result: "done",
      stopReason: this.aborted ? "interrupted" : "end_turn",
    };
  }
  async [Symbol.asyncDispose]() {
    this.disposing.resolve();
    await this.close.promise;
    this.disposed = true;
  }
}

function fixture(sessions: FakeSession[]) {
  const opened: string[] = [];
  const take = (kind: string, id: string) => {
    opened.push(`${kind}:${id}`);
    const session = sessions.shift();
    if (!session) throw new Error("Unexpected SDK session");
    return session;
  };
  // Only the two session factories are used by the runner. Keep this fake local
  // rather than replacing the SDK module for other tests in this process.
  const client = {
    createSession: (id: string) => take("create", id),
    resumeSession: (id: string) => take("resume", id),
  } as unknown as LettaAgentClient;
  const runner = new AgentSdkTurnRunner(client, "agent", {
    sharingDomain: "example-14-test",
    sessionOptions: createA2ASessionOptions("/tmp/example-14"),
  });
  const run = (
    id: string,
    signal = new AbortController().signal,
    context = "context",
  ) =>
    runner.runTurn({
      a2aContextId: context,
      messageId: id,
      text: id,
      signal,
      onAssistantText() {},
    });
  return { opened, run };
}

// A turn can enter its session through promises alone. Yield one event-loop
// checkpoint to drain those jobs while explicit session barriers remain held;
// no wall-clock delay or live SDK work is involved.
const checkpoint = () => setImmediate();

describe("AgentSdkTurnRunner cancellation and serialization", () => {
  test("cancelled waiter B cannot let C overtake active A", async () => {
    const a = new FakeSession("conversation");
    const c = new FakeSession("conversation");
    const { run, opened } = fixture([a, c]);
    const first = run("A");
    await a.started.promise;
    const controller = new AbortController();
    const second = run("B", controller.signal);
    const cancelled = assert.rejects(second, LettaTurnCancelledError);
    controller.abort();
    await cancelled;
    const third = run("C");
    try {
      await checkpoint();
      assert.deepEqual(opened, ["create:agent"]);
      a.finish.resolve();
      await first;
      await c.started.promise;
      assert.equal(a.disposed, true);
      assert.deepEqual(opened, ["create:agent", "resume:conversation"]);
    } finally {
      a.finish.resolve();
      c.finish.resolve();
      await Promise.allSettled([first, third]);
    }
  });

  test("multiple cancelled waiters, including pre-aborted requests, preserve the queue", async () => {
    const a = new FakeSession("conversation");
    const d = new FakeSession("conversation");
    const { run, opened } = fixture([a, d]);
    const first = run("A");
    await a.started.promise;
    const b = new AbortController();
    const c = new AbortController();
    c.abort();
    const second = run("B", b.signal);
    const third = run("C", c.signal);
    const cancelled = Promise.all([
      assert.rejects(second, LettaTurnCancelledError),
      assert.rejects(third, LettaTurnCancelledError),
    ]);
    b.abort();
    await cancelled;
    const fourth = run("D");
    try {
      await checkpoint();
      assert.deepEqual(opened, ["create:agent"]);
      a.finish.resolve();
      await first;
      await d.started.promise;
      assert.deepEqual(opened, ["create:agent", "resume:conversation"]);
    } finally {
      a.finish.resolve();
      d.finish.resolve();
      await Promise.allSettled([first, fourth]);
    }
  });

  test("uncertain active cancellation holds disposal then quarantines the next turn", async () => {
    const a = new FakeSession("conversation", true);
    const b = new FakeSession("conversation");
    const { run, opened } = fixture([a, b]);
    const controller = new AbortController();
    const first = run("A", controller.signal);
    const cancelled = assert.rejects(first, /reconciliation/);
    await a.started.promise;
    const second = run("B");
    const blocked = assert.rejects(second, /reconciliation/);
    try {
      controller.abort();
      assert.equal(a.aborted, true);
      await checkpoint();
      assert.deepEqual(opened, ["create:agent"]);
      a.finish.resolve();
      await a.disposing.promise;
      await checkpoint();
      assert.deepEqual(opened, ["create:agent"]);
      a.close.resolve();
      await cancelled;
      await blocked;
      assert.equal(a.disposed, true);
      assert.deepEqual(opened, ["create:agent"]);
    } finally {
      a.finish.resolve();
      a.close.resolve();
      b.finish.resolve();
      await Promise.allSettled([cancelled, second]);
    }
  });

  test("independent contexts can run in parallel", async () => {
    const a = new FakeSession("conversation-a");
    const b = new FakeSession("conversation-b");
    const { run, opened } = fixture([a, b]);
    const first = run("A", undefined, "context-a");
    await a.started.promise;
    const second = run("B", undefined, "context-b");
    try {
      await b.started.promise;
      assert.equal(a.disposed, false);
      assert.deepEqual(opened, ["create:agent", "create:agent"]);
    } finally {
      a.finish.resolve();
      b.finish.resolve();
      await Promise.all([first, second]);
    }
  });
});
