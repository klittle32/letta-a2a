import { describe, test, expect } from "bun:test";
import { setImmediate } from "node:timers/promises";
import assert from "node:assert/strict";
import {
  AgentSdkTurnRunner,
  createBridge,
  listenLoopback,
  createToolPolicy,
  readText,
  textPart,
} from "../src/index.js";
import {
  Role,
  TaskState,
  AGENT_CARD_PATH,
  AgentCard,
  CancelTaskRequest,
  GetTaskRequest,
  SendMessageRequest,
  SendMessageConfiguration,
  type Message,
  type Part,
  type Task,
} from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import { InMemoryTaskStore, ServerCallContext } from "@a2a-js/sdk/server";
const callContext = new ServerCallContext({ requestedVersion: "1.0" });
import type { LettaAgentClient, SDKMessage } from "@letta-ai/letta-agent-sdk";

function request(
  input: Message = message(),
  configuration?: SendMessageConfiguration,
): SendMessageRequest {
  return { message: input, configuration, tenant: "", metadata: undefined };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
class Session {
  started = deferred();
  finish = deferred();
  disposed = false;
  aborted = false;
  constructor(readonly conversationId: string) {}
  async ready() {
    return { conversationId: this.conversationId };
  }
  async send() {
    this.started.resolve();
  }
  async abort() {
    this.aborted = true;
  }
  async *stream(): AsyncGenerator<SDKMessage> {
    await this.finish.promise;
    yield {
      type: "result",
      success: true,
      result: "done",
      durationMs: 0,
      conversationId: this.conversationId,
      stopReason: this.aborted ? "interrupted" : "end_turn",
    };
  }
  async [Symbol.asyncDispose]() {
    this.disposed = true;
  }
}
function runnerFixture(sessions: Session[]) {
  const opened: string[] = [];
  const take = (id: string) => {
    opened.push(id);
    return sessions.shift()!;
  };
  const client = {
    createSession: take,
    resumeSession: take,
  } as unknown as LettaAgentClient;
  const runner = new AgentSdkTurnRunner(client, "agent", {
    sessionOptions: createToolPolicy([]),
    sharingDomain: "test",
  });
  const run = (
    messageId: string,
    signal = new AbortController().signal,
    a2aContextId = "context",
  ) =>
    runner.runTurn({
      messageId,
      signal,
      a2aContextId,
      text: messageId,
      onAssistantText() {},
    });
  return { runner, run, opened };
}
function message(contextId = ""): Message {
  return {
    role: Role.ROLE_USER,
    messageId: crypto.randomUUID(),
    contextId,
    taskId: "",
    parts: [textPart("hi")],
    extensions: [],
    referenceTaskIds: [],
    metadata: undefined,
  };
}
const options = {
  sharingDomain: "test",
  publicBaseUrl: "http://127.0.0.1:9999",
};

describe("extracted bridge", () => {
  test("cancelled waiter cannot release predecessor; contexts continue", async () => {
    const a = new Session("conversation"),
      c = new Session("conversation");
    const { run, opened } = runnerFixture([a, c]);
    const first = run("A");
    await a.started.promise;
    const abort = new AbortController();
    const second = run("B", abort.signal);
    const cancelled = assert.rejects(second, /cancelled/);
    abort.abort();
    await cancelled;
    const third = run("C");
    await setImmediate();
    expect(opened).toEqual(["agent"]);
    a.finish.resolve();
    await first;
    await c.started.promise;
    expect(a.disposed).toBe(true);
    expect(opened).toEqual(["agent", "conversation"]);
    c.finish.resolve();
    await third;
  });
  test("independent contexts run concurrently", async () => {
    const a = new Session("a"),
      b = new Session("b");
    const { run } = runnerFixture([a, b]);
    const first = run("A", undefined, "a"),
      second = run("B", undefined, "b");
    await Promise.all([a.started.promise, b.started.promise]);
    a.finish.resolve();
    b.finish.resolve();
    await Promise.all([first, second]);
  });
  test("strict mixed and missing content is refused", () => {
    const contents: Part["content"][] = [
      undefined,
      { $case: "data", value: {} },
      { $case: "url", value: "https://example.com" },
      { $case: "raw", value: Buffer.alloc(0) },
    ];
    for (const content of contents) {
      expect(() =>
        readText({
          ...message(),
          parts: [textPart("hi"), { ...textPart(""), content }],
        }),
      ).toThrow("Only text");
    }
  });
  test("tool policy denies everything not explicitly allowed", async () => {
    const policy = createToolPolicy(["a2a_invoke"]);
    expect(policy.permissionMode).toBe("strict");
    expect(policy.toolset).toEqual({ base: "none" });
    expect((await policy.canUseTool!("a2a_invoke", {})).behavior).toBe("allow");
    expect((await policy.canUseTool!("Bash", {})).behavior).toBe("deny");
  });
  test("official HTTP discovery and two context turns", async () => {
    const contexts: string[] = [];
    const bridge = createBridge({
      ...options,
      runner: {
        async runTurn(r) {
          contexts.push(r.a2aContextId);
          r.onAssistantText("hello");
          return { text: "hello" };
        },
      },
    });
    const listener = await listenLoopback(bridge, { port: 0 });
    try {
      const card = AgentCard.fromJSON(
        await (await fetch(`${listener.url}/${AGENT_CARD_PATH}`)).json(),
      );
      assert(card.capabilities);
      expect(card.capabilities.streaming).toBe(true);
      expect(card.capabilities.pushNotifications).toBe(false);
      const client = await new ClientFactory().createFromUrl(listener.url);
      const first = await client.sendMessage(request());
      assert("status" in first);
      expect(first.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
      await client.sendMessage(request(message(first.contextId)));
      expect(contexts.length).toBe(2);
      expect(contexts[0]).toBe(contexts[1]);
    } finally {
      expect((await listener.close()).complete).toBe(true);
    }
  });
  test("executor refuses mixed input before Letta and sanitizes partial failure", async () => {
    let calls = 0;
    const bridge = createBridge({
      ...options,
      runner: {
        async runTurn(r) {
          calls++;
          r.onAssistantText("partial");
          throw new Error("secret-token");
        },
      },
    });
    const mixed = message();
    mixed.parts.push({
      ...textPart(""),
      content: { $case: "data", value: {} },
    });
    await expect(
      bridge.requestHandler.sendMessage(request(mixed), callContext),
    ).rejects.toThrow("Only nonempty text/plain input is supported");
    expect(calls).toBe(0);
    const events = [];
    for await (const event of bridge.requestHandler.sendMessageStream(
      request(),
      callContext,
    ))
      events.push(event.payload);
    expect(JSON.stringify(events)).toContain("partial");
    expect(JSON.stringify(events)).not.toContain("secret-token");
    expect(
      events.some((e) => e?.$case === "artifactUpdate" && !e.value.lastChunk),
    ).toBe(true);
    const final = events.at(-1);
    assert(final?.$case === "statusUpdate");
    expect(final.value.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    await bridge.close();
  });
  test("bounded idempotent close does not pretend an unknown turn stopped", async () => {
    const finish = deferred(),
      started = deferred();
    let aborted = false;
    const bridge = createBridge({
      ...options,
      shutdownTimeoutMs: 10,
      runner: {
        async runTurn(r) {
          r.signal.addEventListener("abort", () => {
            aborted = true;
          });
          started.resolve();
          await finish.promise;
          return { text: "" };
        },
      },
    });
    const pending = bridge.requestHandler.sendMessage(request(), callContext);
    await started.promise;
    const close = bridge.close();
    expect(bridge.close()).toBe(close);
    expect((await close).complete).toBe(false);
    expect(aborted).toBe(true);
    const later = await bridge.requestHandler.sendMessage(
      request(),
      callContext,
    );
    assert("status" in later);
    expect(later.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    finish.resolve();
    await pending;
  });
  test("anonymous execution refuses tenant/authenticated contexts and unsupported output", async () => {
    let calls = 0;
    const bridge = createBridge({
      ...options,
      runner: {
        async runTurn() {
          calls++;
          return { text: "" };
        },
      },
    });
    for (const context of [
      new ServerCallContext({ tenant: "tenant" }),
      new ServerCallContext({
        user: { isAuthenticated: true, userName: "alice" },
      }),
    ]) {
      await expect(
        bridge.requestHandler.sendMessage(request(), context),
      ).rejects.toThrow("Operation forbidden");
    }
    await expect(
      bridge.requestHandler.sendMessage(
        request(
          message(),
          SendMessageConfiguration.fromJSON({
            acceptedOutputModes: ["image/png"],
          }),
        ),
        callContext,
      ),
    ).rejects.toThrow("Only text/plain output is supported");
    expect(calls).toBe(0);
    await bridge.close();
  });
  test("unknown runtime completion quarantines context and reports incomplete close", async () => {
    const broken = new Session("conversation");
    broken.stream = async function* () {
      yield {
        type: "assistant",
        content: "partial",
        uuid: crypto.randomUUID(),
      };
    };
    const { runner, run, opened } = runnerFixture([
      broken,
      new Session("conversation"),
    ]);
    await assert.rejects(run("A"), /without a result/);
    await assert.rejects(run("B"), /reconciliation/);
    expect(opened).toEqual(["agent"]);
    const bridge = createBridge({ ...options, runner });
    const result = await bridge.close();
    expect(result.complete).toBe(false);
    expect(result.unresolvedContextIds).toEqual(["context"]);
  });
  test("successful streams maintain artifact identity and final chunk boundaries", async () => {
    const bridge = createBridge({
      ...options,
      runner: {
        async runTurn(r) {
          r.onAssistantText("one");
          r.onAssistantText("two");
          return { text: "onetwo" };
        },
      },
    });
    const artifacts = [];
    for await (const event of bridge.requestHandler.sendMessageStream(
      request(),
      callContext,
    )) {
      if (event.payload?.$case === "artifactUpdate")
        artifacts.push(event.payload.value);
    }
    expect(artifacts.map((a) => [a.append, a.lastChunk])).toEqual([
      [false, false],
      [true, true],
    ]);
    assert(artifacts[0].artifact);
    assert(artifacts[1].artifact);
    expect(artifacts[0].artifact.artifactId).toBe(
      artifacts[1].artifact.artifactId,
    );
    await bridge.close();
  });
  test("official cancellation holds a running SDK turn and aborts queued work on close", async () => {
    const a = new Session("conversation"),
      b = new Session("conversation");
    const { runner, opened } = runnerFixture([a, b]);
    const bridge = createBridge({ ...options, runner, shutdownTimeoutMs: 10 });
    let taskId = "";
    const stream = (async () => {
      for await (const event of bridge.requestHandler.sendMessageStream(
        request(message("context")),
        callContext,
      )) {
        if (event.payload?.$case === "task") taskId = event.payload.value.id;
      }
    })();
    await a.started.promise;
    await setImmediate();
    const queued = bridge.requestHandler.sendMessage(
      request(message("context")),
      callContext,
    );
    const cancel = bridge.requestHandler.cancelTask(
      CancelTaskRequest.fromJSON({ id: taskId }),
      callContext,
    );
    await setImmediate();
    expect(a.aborted).toBe(true);
    expect(opened).toEqual(["agent"]);
    const result = await bridge.close();
    expect(result.complete).toBe(false);
    await queued;
    expect(opened).toEqual(["agent"]);
    a.finish.resolve();
    await stream;
    await cancel;
  });
  test("cancellation retains the barrier through asynchronous disposal", async () => {
    const a = new Session("conversation"),
      b = new Session("conversation");
    const disposing = deferred(),
      release = deferred();
    a[Symbol.asyncDispose] = async () => {
      disposing.resolve();
      await release.promise;
      a.disposed = true;
    };
    const { run, opened } = runnerFixture([a, b]);
    const controller = new AbortController();
    const first = run("A", controller.signal);
    const cancelled = assert.rejects(first, /cancelled/);
    await a.started.promise;
    const second = run("B");
    controller.abort();
    a.finish.resolve();
    await disposing.promise;
    await setImmediate();
    expect(opened).toEqual(["agent"]);
    release.resolve();
    await cancelled;
    await b.started.promise;
    expect(a.disposed).toBe(true);
    b.finish.resolve();
    await second;
  });
  test("injected official task store receives the trusted scoped request context", async () => {
    const seen: ServerCallContext[] = [];
    class Store extends InMemoryTaskStore {
      override async save(task: Task, context?: ServerCallContext) {
        assert(context);
        seen.push(context);
        await super.save(task, context);
      }
    }
    const bridge = createBridge({
      ...options,
      taskStore: new Store(),
      runner: {
        async runTurn() {
          return { text: "done" };
        },
      },
    });
    const task = await bridge.requestHandler.sendMessage(
      request(),
      callContext,
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(
      seen.every(
        (c) =>
          c !== callContext &&
          c.requestedVersion === callContext.requestedVersion &&
          !!c.user?.userName,
      ),
    ).toBe(true);
    assert("id" in task);
    const readback = await bridge.requestHandler.getTask(
      GetTaskRequest.fromJSON({ id: task.id, historyLength: 0 }),
      callContext,
    );
    assert(readback.status);
    expect(readback.status.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(readback.history).toEqual([]);
    await bridge.close();
  });
  test("SDK composition forwards explicit session policy without creating agents", async () => {
    const session = new Session("conversation");
    session.finish.resolve();
    const policy = { ...createToolPolicy(["custom_tool"]), cwd: "/tmp/custom" };
    const seen: Parameters<LettaAgentClient["createSession"]>[] = [];
    const client = {
      createSession(...args: Parameters<LettaAgentClient["createSession"]>) {
        seen.push(args);
        return session;
      },
      resumeSession() {
        throw new Error("unexpected resume");
      },
    } as unknown as LettaAgentClient;
    const bridge = createBridge({
      ...options,
      client,
      agentId: "existing-agent",
      sessionOptions: policy,
    });
    expect(seen).toEqual([]);
    await bridge.requestHandler.sendMessage(request(), callContext);
    expect(seen).toEqual([["existing-agent", policy]]);
    expect(session.disposed).toBe(true);
    await bridge.close();
  });
  test("anonymous profile refuses nonloopback advertisement", () => {
    expect(() =>
      createBridge({
        ...options,
        publicBaseUrl: "http://0.0.0.0:9999",
        runner: {
          async runTurn() {
            return { text: "" };
          },
        },
      }),
    ).toThrow("loopback");
  });
});
