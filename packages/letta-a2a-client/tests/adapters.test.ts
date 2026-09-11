import { describe, expect, test } from "bun:test";
import { Message, Task, TaskState } from "@a2a-js/sdk";
import { createA2ATools } from "../src/agent-sdk.js";
import { A2AInvocationError, type A2AInvoker } from "../src/a2a-invoker.js";
import { A2AToolService } from "../src/tool-service.js";
import { MemoryContextStore } from "../src/context-store.js";
import activate from "../mods/a2a-client.js";
import type { LettaModTool } from "../src/mod-api.js";
import { getA2AToolDefinitions } from "../src/tool-operations.js";
import { A2AModController } from "../src/mod-controller.js";
import {
  A2A_TOOL_DEFINITIONS,
  projectA2AResult,
  runA2ATool,
  type A2AToolClient,
} from "../src/tool-operations.js";

const scope = () => ({ agentId: "agent-1", conversationId: "conversation-1" });
const task = Task.fromJSON({
  id: "task-1",
  contextId: "context-1",
  status: { state: TaskState.TASK_STATE_COMPLETED },
  artifacts: [{ artifactId: "artifact-1", parts: [{ text: "answer" }] }],
});
function fixture() {
  const scopes: string[] = [];
  const client: A2AToolClient = {
    async invoke(input) {
      scopes.push(input.localScope);
      return task;
    },
    async task(input) {
      scopes.push(input.localScope);
      return task;
    },
    targets: () => ["remote"],
    async drain() {},
  };
  return { client, scopes };
}
const args = { target: "remote", message: "hello" };

describe("shared A2A adapters", () => {
  test("trusted recovery guidance survives projection without exposing raw exceptions", async () => {
    const store = new MemoryContextStore();
    const client = new A2AToolService(
      { remote: "https://example.test" },
      {} as A2AInvoker,
      store,
    );
    const options = {
      client,
      getScope: scope,
      signal: new AbortController().signal,
    };
    await store.set("agent-1/conversation-1/remote", "legacy-context");
    const legacy = JSON.parse(
      (await runA2ATool("a2a_invoke", args, options)).content,
    );
    expect(legacy.error).toContain("Legacy A2A context");
    expect(legacy.error).toContain("legacy-context");
    await store.set(
      JSON.stringify([
        "a2a-binding",
        "agent-1/conversation-1",
        "https://example.test/",
      ]),
      JSON.stringify({ submissionUnknown: true, messageId: "unknown-message" }),
    );
    const unknown = JSON.parse(
      (await runA2ATool("a2a_invoke", args, options)).content,
    );
    expect(unknown.error).toContain("Unknown A2A submission");
    expect(unknown.messageId).toBe("unknown-message");
  });

  test("tool schema roots use the provider-supported object subset", () => {
    for (const tool of A2A_TOOL_DEFINITIONS) {
      expect(tool.parameters.type).toBe("object");
      for (const keyword of [
        "oneOf",
        "anyOf",
        "allOf",
        "enum",
        "const",
        "not",
      ]) {
        expect(Object.hasOwn(tool.parameters, keyword)).toBe(false);
      }
    }
  });
  test("strict arguments and trusted ready scope", async () => {
    const { client, scopes } = fixture();
    for (const bad of [
      { ...args, localScope: "injected" },
      { ...args, agentId: "evil" },
      { ...args, new_context: true, task_id: "x" },
      { ...args, new_context: true, context_id: "x" },
      { ...args, message: 4 },
      null,
    ]) {
      expect(
        (
          await runA2ATool("a2a_invoke", bad, {
            client,
            getScope: scope,
            signal: new AbortController().signal,
          })
        ).isError,
      ).toBe(true);
    }
    for (const getScope of [
      () => undefined,
      () => ({ agentId: "a/b", conversationId: "c" }),
      () => ({ agentId: "a", conversationId: "" }),
    ]) {
      expect(
        (
          await runA2ATool("a2a_invoke", args, {
            client,
            getScope,
            signal: new AbortController().signal,
          })
        ).isError,
      ).toBe(true);
    }
    expect(scopes).toEqual([]);
  });

  test("SDK and mod have identical schemas and results", async () => {
    const { client } = fixture();
    const owner = new AbortController();
    const group = createA2ATools({
      client,
      getScope: scope,
      signal: owner.signal,
    });
    const mod = new A2AModController(client);
    const context = {
      args,
      signal: owner.signal,
      sessionId: "ignored",
      agent: { id: "agent-1" },
      conversation: { id: "conversation-1" },
    };
    const sdk = await group.tools[0]!.execute("call", args);
    const modResult = await mod.run("a2a_invoke", context);
    expect(typeof modResult).toBe("string");
    if (typeof modResult !== "string") throw new Error("Expected mod success");
    expect(sdk.content[0]?.text).toEqual(modResult);
    expect(group.tools.map((t) => t.name)).toEqual(["a2a_invoke", "a2a_task"]);
    await group[Symbol.asyncDispose]();
    await group.close();
  });

  test("session scopes and reconnect groups are independent", async () => {
    const { client, scopes } = fixture();
    const owner = new AbortController();
    const first = createA2ATools({
      client,
      getScope: scope,
      signal: owner.signal,
    });
    const second = createA2ATools({
      client,
      getScope: () => ({
        agentId: "agent-1",
        conversationId: "conversation-2",
      }),
      signal: new AbortController().signal,
    });
    await first.tools[0]!.execute("1", args);
    await first.close();
    await second.tools[0]!.execute("2", args);
    const reconnect = createA2ATools({
      client,
      getScope: scope,
      signal: new AbortController().signal,
    });
    await reconnect.tools[0]!.execute("3", args);
    expect(scopes).toEqual([
      "agent-1/conversation-1",
      "agent-1/conversation-2",
      "agent-1/conversation-1",
    ]);
    await second.close();
    await reconnect.close();
  });

  test("owner abort reaches two-argument SDK execute and close waits", async () => {
    const { client } = fixture();
    let observed: AbortSignal | undefined;
    client.invoke = async (input) => {
      observed = input.signal;
      return new Promise((_, reject) =>
        input.signal.addEventListener(
          "abort",
          () => reject(new Error("stopped")),
          { once: true },
        ),
      );
    };
    const owner = new AbortController();
    const group = createA2ATools({
      client,
      getScope: scope,
      signal: owner.signal,
    });
    const pending = group.tools[0]!.execute("1", args);
    owner.abort();
    expect(observed?.aborted).toBe(true);
    await group.close();
    await pending;
    expect((await group.tools[0]!.execute("2", args)).isError).toBe(true);
  });

  test("SDK resolves scope at execution after ready and combines future signals", async () => {
    const { client, scopes } = fixture();
    let ready = false;
    const group = createA2ATools({
      client,
      getScope: () => (ready ? scope() : undefined),
      signal: new AbortController().signal,
    });
    expect((await group.tools[0]!.execute("before", args)).isError).toBe(true);
    ready = true;
    expect((await group.tools[0]!.execute("after", args)).isError).toBe(false);
    const call = new AbortController();
    call.abort();
    expect(
      (await group.tools[0]!.execute("aborted", args, call.signal)).isError,
    ).toBe(true);
    expect(scopes).toHaveLength(1);
    await group.close();
  });

  test("async disposal aborts active calls without aborting the owner's signal", async () => {
    const { client } = fixture();
    const owner = new AbortController();
    let stopped = false;
    client.invoke = (input) =>
      new Promise((_, reject) => {
        input.signal.addEventListener(
          "abort",
          () => {
            stopped = true;
            reject(new Error("Disposed"));
          },
          { once: true },
        );
      });
    const group = createA2ATools({
      client,
      getScope: scope,
      signal: owner.signal,
    });
    const pending = group.tools[0]!.execute("call", args);
    await group[Symbol.asyncDispose]();
    expect(stopped).toBe(true);
    expect(owner.signal.aborted).toBe(false);
    expect((await pending).isError).toBe(true);
  });

  test("real service early cancellation result cannot hide underlying invocation cleanup", async () => {
    let release!: () => void;
    let accepted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    const invoker: A2AInvoker = {
      async invoke(input) {
        await input.onTask?.({
          ...task,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            message: undefined,
            timestamp: undefined,
          },
        });
        accepted();
        await blocked;
        return task;
      },
      async getTask() {
        return task;
      },
      async cancelTask() {
        return task;
      },
      async *stream() {
        throw new Error("Unused in this test");
      },
      async *subscribe() {
        throw new Error("Unused in this test");
      },
      async connect() {
        throw new Error("Unused in this test");
      },
    };
    const service = new A2AToolService(
      { remote: "https://example.test/a2a" },
      invoker,
      new MemoryContextStore(),
    );
    let callerSignal: AbortSignal | undefined;
    const drain = service.drain.bind(service);
    service.drain = (signal) => {
      callerSignal = signal;
      return drain(signal);
    };
    const group = createA2ATools({
      client: service,
      getScope: scope,
      signal: new AbortController().signal,
      closeTimeoutMs: 5,
    });
    const pending = group.tools[0]!.execute("call", args);
    await ready;
    try {
      const closing = group.close();
      const result = await pending;
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("working");
      expect(result.content[0]?.text).toContain("not-confirmed");
      await expect(closing).rejects.toThrow("cleanup incomplete");
      expect(callerSignal).toBeDefined();
    } finally {
      release();
      if (callerSignal) await drain(callerSignal);
      service.close();
    }
  });

  test("close rejects while underlying work outlives its caller-facing result", async () => {
    const { client } = fixture();
    const seen: AbortSignal[] = [];
    const drained: AbortSignal[] = [];
    let finish!: () => void;
    const underlying = new Promise<void>((resolve) => {
      finish = resolve;
    });
    client.invoke = async (input) => {
      seen.push(input.signal);
      throw new A2AInvocationError("Caller wait ended", {
        submissionAttempted: true,
        task: {
          ...task,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            message: undefined,
            timestamp: undefined,
          },
        },
      });
    };
    client.drain = (signal) => {
      drained.push(signal);
      return underlying;
    };
    const owner = new AbortController();
    const group = createA2ATools({
      client,
      getScope: scope,
      signal: owner.signal,
      closeTimeoutMs: 5,
    });
    const result = await group.tools[0]!.execute("call", args);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("working");
    await expect(group.close()).rejects.toThrow("cleanup incomplete");
    expect(drained).toEqual(seen);
    finish();
  });

  test("close waits exact owner and combined call signals, not another group", async () => {
    const { client } = fixture();
    const finish = new Map<AbortSignal, () => void>();
    const underlying = new Map<AbortSignal, Promise<void>>();
    const drained: AbortSignal[] = [];
    client.invoke = async (input) => {
      underlying.set(
        input.signal,
        new Promise<void>((resolve) => {
          finish.set(input.signal, resolve);
        }),
      );
      return task;
    };
    client.drain = (signal) => {
      drained.push(signal);
      return underlying.get(signal) ?? Promise.resolve();
    };
    const group = createA2ATools({
      client,
      getScope: scope,
      signal: new AbortController().signal,
    });
    const other = createA2ATools({
      client,
      getScope: scope,
      signal: new AbortController().signal,
    });
    await group.tools[0]!.execute("owner", args);
    await group.tools[0]!.execute(
      "combined",
      args,
      new AbortController().signal,
    );
    await other.tools[0]!.execute("other", args);
    const signals = [...underlying.keys()];
    let closed = false;
    const closing = group.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(false);
    expect(drained).toEqual(signals.slice(0, 2));
    finish.get(signals[0]!)!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(false);
    finish.get(signals[1]!)!();
    await closing;
    expect(closed).toBe(true);
    expect(drained).not.toContain(signals[2]!);
    finish.get(signals[2]!)!();
    await other.close();
  });

  test("SDK advertises configured targets in both tools", async () => {
    const { client } = fixture();
    const group = createA2ATools({
      client,
      getScope: scope,
      signal: new AbortController().signal,
    });
    for (const tool of group.tools) {
      expect(tool.description).toContain("Configured targets: remote");
      expect(tool.parameters.properties.target.enum).toEqual(["remote"]);
    }
    await group.close();
  });

  test("small structured data gets a safe bounded JSON preview", () => {
    const data = {
      count: 3,
      ok: true,
      values: [1, null, false],
      secret: "private-value",
      metadata: { reasoning: "hidden-value" },
    };
    const message = Message.fromJSON({
      messageId: "m",
      contextId: "c",
      parts: [{ data }],
    });
    const result = projectA2AResult("remote", message);
    const preview = JSON.parse(result.content).parts[0].preview;
    expect(preview.count).toBe(3);
    expect(preview.ok).toBe(true);
    expect(preview.values).toEqual([1, null, false]);
    expect(result.content).toContain("omitted");
    expect(result.content).not.toContain("private-value");
    expect(result.content).not.toContain("hidden-value");
    expect(message.parts[0]?.content?.value).toEqual(data);
  });

  test("drain failures reject cleanup without exposing raw errors", async () => {
    const { client } = fixture();
    client.drain = async () => {
      throw new Error("Authorization: private-value");
    };
    const group = createA2ATools({
      client,
      getScope: scope,
      signal: new AbortController().signal,
    });
    await group.tools[0]!.execute("call", args);
    await expect(group.close()).rejects.toThrow(
      "A2A tool cleanup incomplete: local operation drain failed",
    );
    expect(group.close()).toBe(group.close());
  });

  test("large data previews remain bounded and all filtering is explicit", () => {
    const data = {
      rows: Array.from({ length: 100 }, () => ({
        count: 42,
        label: "unclassified-private-value",
      })),
      nested: { one: { two: { three: 1 } } },
    };
    const message = Message.fromJSON({
      messageId: "m",
      parts: Array.from({ length: 100 }, () => ({ data })),
    });
    const result = projectA2AResult("remote", message);
    expect(result.content.length).toBeLessThanOrEqual(16_000);
    expect(result.content).toContain("omitted");
    expect(result.content).not.toContain("unclassified-private-value");
    const parsed = JSON.parse(result.content);
    expect(parsed.omittedParts).toBeGreaterThan(0);
    expect(message.parts).toHaveLength(100);
  });

  test("incomplete cleanup rejects", async () => {
    const { client } = fixture();
    let finish!: (value: Task) => void;
    client.invoke = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const group = createA2ATools({
      client,
      getScope: scope,
      signal: new AbortController().signal,
      closeTimeoutMs: 5,
    });
    const pending = group.tools[0]!.execute("1", args);
    await expect(group.close()).rejects.toThrow("cleanup incomplete");
    finish(task);
    await pending;
  });

  test("partial failure retains readback and authoritative cancellation without causes", async () => {
    const { client } = fixture();
    client.invoke = async () => {
      throw new A2AInvocationError("Readback failed", {
        submissionAttempted: true,
        messageId: "message-1",
        task,
        cancellation: {
          ...task,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            message: undefined,
            timestamp: undefined,
          },
        },
        cause: new Error("Authorization: secret"),
      });
    };
    const result = await runA2ATool("a2a_invoke", args, {
      client,
      getScope: scope,
      signal: new AbortController().signal,
    });
    const json = JSON.parse(result.content);
    expect(result.isError).toBe(true);
    expect(json.taskId).toBe("task-1");
    expect(json.contextId).toBe("context-1");
    expect(json.messageId).toBe("message-1");
    expect(json.cancellation).toBe("requested-not-confirmed");
    expect(json.submissionAttempted).toBe(true);
    expect(result.content).not.toContain("secret");
  });

  test("task get/cancel validation and direct message projection", async () => {
    const { client } = fixture();
    const options = {
      client,
      getScope: scope,
      signal: new AbortController().signal,
    };
    for (const bad of [
      { target: "remote", task_id: "t", action: "delete" },
      { target: "remote", action: "get" },
      {
        target: "remote",
        task_id: "t",
        action: "get",
        conversation_id: "evil",
      },
    ]) {
      expect((await runA2ATool("a2a_task", bad, options)).isError).toBe(true);
    }
    expect(
      JSON.parse(
        (
          await runA2ATool(
            "a2a_task",
            { target: "remote", task_id: "t", action: "cancel" },
            options,
          )
        ).content,
      ).cancellation,
    ).toBe("requested-not-confirmed");
    client.task = async () => ({
      ...task,
      status: {
        state: TaskState.TASK_STATE_CANCELED,
        message: undefined,
        timestamp: undefined,
      },
    });
    expect(
      JSON.parse(
        (
          await runA2ATool(
            "a2a_task",
            { target: "remote", task_id: "t", action: "cancel" },
            options,
          )
        ).content,
      ).cancellation,
    ).toBe("confirmed");
    expect(
      (
        await runA2ATool(
          "a2a_invoke",
          { ...args, context_id: "c", task_id: "t" },
          options,
        )
      ).isError,
    ).toBe(false);
    const message = Message.fromJSON({
      messageId: "m",
      contextId: "c",
      parts: [{ data: [1, 2] }, { text: "answer" }],
    });
    const result = JSON.parse(projectA2AResult("remote", message).content);
    expect(result.status).toBe("message");
    expect(result.text).toBe("answer");
    expect(result.parts[0].type).toBe("data");
  });

  test("mod guards capability, registers both approved tools, and cleans up", () => {
    const registered: LettaModTool[] = [];
    let removed = 0;
    const api = {
      capabilities: { tools: false },
      diagnostics: { report() {} },
      tools: {
        register(tool: LettaModTool) {
          registered.push(tool);
          return () => {
            removed++;
          };
        },
      },
    };
    expect(activate(api)).toBeUndefined();
    expect(registered).toHaveLength(0);
    const previous = process.env.LETTA_A2A_ROUTES;
    process.env.LETTA_A2A_ROUTES = JSON.stringify({
      remote: "https://example.test/a2a",
    });
    try {
      api.capabilities.tools = true;
      const close = activate(api);
      expect(registered).toHaveLength(2);
      for (const [index, tool] of registered.entries()) {
        expect(tool.parameters).toEqual(
          getA2AToolDefinitions({ targets: () => ["remote"] })[index]!
            .parameters,
        );
        expect(tool.description).toContain("Configured targets: remote");
        expect(tool.requiresApproval).toBe(true);
        expect(tool.parallelSafe).toBe(false);
      }
      close?.();
      close?.();
      expect(removed).toBe(2);
    } finally {
      if (previous === undefined) delete process.env.LETTA_A2A_ROUTES;
      else process.env.LETTA_A2A_ROUTES = previous;
    }
  });

  test("mod configuration failures stay visible with both tools registered", async () => {
    const registered: LettaModTool[] = [];
    const diagnostics: string[] = [];
    const previous = process.env.LETTA_A2A_ROUTES;
    process.env.LETTA_A2A_ROUTES = "{}";
    try {
      const close = activate({
        capabilities: { tools: true },
        diagnostics: {
          report(input) {
            diagnostics.push(input.message);
          },
        },
        tools: {
          register(tool) {
            registered.push(tool);
            return () => {};
          },
        },
      });
      expect(diagnostics).toHaveLength(1);
      expect(registered).toHaveLength(2);
      for (const tool of registered) {
        const result = await tool.run({
          args,
          agent: { id: "a" },
          conversation: { id: "c" },
          sessionId: "unused",
          signal: new AbortController().signal,
        });
        expect(result).toEqual({
          status: "error",
          content: "A2A configuration must contain at least one route",
        });
      }
      close?.();
    } finally {
      if (previous === undefined) delete process.env.LETTA_A2A_ROUTES;
      else process.env.LETTA_A2A_ROUTES = previous;
    }
  });

  test("escaped output remains bounded with explicit artifact and part omission", () => {
    const huge = Task.fromJSON({
      id: "t",
      contextId: "c",
      artifacts: Array.from({ length: 50 }, (_, i) => ({
        artifactId: `a-${i}`,
        parts: Array.from({ length: 50 }, () => ({
          text: "\\u0000".repeat(30_000),
        })),
      })),
    });
    const result = projectA2AResult("remote", huge);
    expect(result.content.length).toBeLessThanOrEqual(16_000);
    const json = JSON.parse(result.content);
    expect(json.omittedArtifacts).toBeGreaterThan(0);
    expect(json.artifacts[0].omittedParts).toBeGreaterThan(0);
    expect(result.content).toContain("truncated");
  });

  test("projection preserves structured/file boundaries and bounds JSON", () => {
    const rich = Task.fromJSON({
      id: task.id,
      contextId: task.contextId,
      status: {
        state: TaskState.TASK_STATE_INPUT_REQUIRED,
        message: { parts: [{ text: "need input" }] },
      },
      artifacts: [
        {
          artifactId: "a",
          parts: [
            { data: { secret: "not printed", count: 3 } },
            { raw: Buffer.from("private bytes").toString("base64") },
          ],
        },
        {
          artifactId: "b",
          parts: [
            { url: "https://example.test/result" },
            { text: "x".repeat(30_000) },
          ],
        },
      ],
      metadata: { reasoning: "hidden" },
    });
    const result = projectA2AResult("remote", rich);
    const json = JSON.parse(result.content);
    expect(result.isError).toBe(false);
    expect(json.status).toBe("input-required");
    expect(json.statusMessage.text).toBe("need input");
    expect(
      json.artifacts.map((a: { artifactId: string }) => a.artifactId),
    ).toEqual(["a", "b"]);
    expect(result.content).toContain("byteCount");
    expect(result.content).toContain("https://example.test/result");
    expect(result.content).toContain("truncated");
    expect(result.content).not.toContain("private bytes");
    expect(result.content).not.toContain("not printed");
    expect(result.content).not.toContain("hidden");
    expect(result.content.length).toBeLessThanOrEqual(16_000);
    expect(rich.artifacts[1]!.parts[1]!.content?.value.length).toBe(30_000);
  });
});
