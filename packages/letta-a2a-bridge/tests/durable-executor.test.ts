import { describe, expect, test } from "bun:test";
import { AgentCard, SendMessageRequest, TaskState } from "@a2a-js/sdk";
import {
  DefaultExecutionEventBus,
  DefaultRequestHandler,
  InMemoryTaskStore,
  RequestContext,
  ServerCallContext,
  type AgentExecutionEvent,
} from "@a2a-js/sdk/server";
import { LettaAgentExecutor } from "../src/letta-agent-executor.js";
import { DurableBinding } from "../src/durable-binding.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LettaTurnCancelledError } from "../src/letta-agent.js";
const card = AgentCard.fromJSON({ capabilities: { streaming: true } });

const params = () =>
  SendMessageRequest.fromJSON({
    message: {
      messageId: "message",
      role: "ROLE_USER",
      parts: [{ text: "hello" }],
    },
  });
const request = () =>
  new RequestContext(
    params(),
    "task",
    "context",
    new ServerCallContext({
      user: { isAuthenticated: true, userName: "owner" },
      tenant: "tenant",
    }),
  );
const key = JSON.stringify(["owner", "tenant", "context"]);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture(
  overrides: Partial<
    Pick<
      DurableBinding,
      | "accept"
      | "dispatched"
      | "publication"
      | "waitPublished"
      | "unresolvedContexts"
    >
  > = {},
) {
  const events: AgentExecutionEvent[] = [];
  const bus = new DefaultExecutionEventBus();
  bus.on("event", (event) => events.push(event));
  const durability = {
    accept: async () => {},
    dispatched: async () => {},
    publication: async () => {},
    waitPublished: async () => {},
    unresolvedContexts: [],
    ...overrides,
  } as unknown as DurableBinding;
  return { events, bus, durability };
}
const terminal = (events: AgentExecutionEvent[]) =>
  events.filter(
    (e) =>
      e.kind === "statusUpdate" &&
      e.data.status?.state !== TaskState.TASK_STATE_WORKING,
  );

describe("durable executor", () => {
  test("accept and dispatch barriers precede runner; publication precedes final wire events and ack precedes close", async () => {
    const accepted = deferred(),
      dispatched = deferred(),
      published = deferred(),
      acknowledged = deferred();
    const publishing = deferred();
    let calls = 0;
    let replay: AgentExecutionEvent[] = [];
    let artifactId = "";
    const f = fixture({
      accept: async (_r, task, id) => {
        expect(task.id).toBe("task");
        artifactId = id;
        await accepted.promise;
      },
      dispatched: async () => {
        await dispatched.promise;
      },
      publication: async (_r, events, stopped) => {
        expect(stopped).toBe(true);
        replay = events;
        publishing.resolve();
        await published.promise;
      },
      waitPublished: async () => {
        await acknowledged.promise;
      },
    });
    const executor = new LettaAgentExecutor(
      {
        runTurn: async (r) => {
          calls++;
          expect(r.taskId).toBe("task");
          r.onAssistantText("one");
          r.onAssistantText("two");
          return { text: "onetwo" };
        },
      },
      100,
      undefined,
      f.durability,
    );
    const execution = executor.execute(request(), f.bus);
    await Promise.resolve();
    expect(calls).toBe(0);
    expect(f.events).toEqual([]);
    accepted.resolve();
    await Promise.resolve();
    expect(calls).toBe(0);
    dispatched.resolve();
    await publishing.promise;
    expect(terminal(f.events)).toEqual([]);
    const replacement = replay[0]!;
    expect(replacement.kind).toBe("artifactUpdate");
    if (replacement.kind === "artifactUpdate") {
      expect(replacement.data.append).toBe(false);
      expect(replacement.data.artifact?.artifactId).toBe(artifactId);
      expect(replacement.data.artifact?.parts).toHaveLength(2);
    }
    published.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(terminal(f.events)[0]).toBe(replay[1]);
    const chunks = f.events.filter((e) => e.kind === "artifactUpdate");
    expect(
      chunks.map((e) => e.kind === "artifactUpdate" && e.data.append),
    ).toEqual([false, true]);
    let closed = false;
    const closing = executor.close().then((result) => {
      closed = true;
      return result;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    acknowledged.resolve();
    await execution;
    expect((await closing).complete).toBe(true);
  });

  test("publication failure never publishes completed/canceled and keeps shutdown unresolved", async () => {
    const errors: unknown[] = [];
    const f = fixture({
      publication: async () => {
        throw new Error("private disk detail");
      },
    });
    const executor = new LettaAgentExecutor(
      { runTurn: async () => ({ text: "answer" }) },
      10,
      (e) => {
        errors.push(e.error);
      },
      f.durability,
    );
    await expect(executor.execute(request(), f.bus)).rejects.toThrow();
    expect(terminal(f.events)).toEqual([]);
    expect(errors).toHaveLength(1);
    expect((await executor.close()).unresolvedContextIds).toContain(key);
  });

  test("uncertain runner cannot certify cancellation and failures request reconciliation", async () => {
    for (const error of [
      new Error("disconnect"),
      new LettaTurnCancelledError(),
    ]) {
      let stopped: boolean | undefined;
      const f = fixture({
        publication: async (_r, _events, confirmed) => {
          stopped = confirmed;
        },
      });
      const executor = new LettaAgentExecutor(
        {
          unresolvedContexts: [key],
          runTurn: async () => {
            throw error;
          },
        },
        10,
        undefined,
        f.durability,
      );
      await executor.execute(request(), f.bus);
      expect(stopped).toBe(false);
      const event = terminal(f.events)[0]!;
      expect(event.kind === "statusUpdate" && event.data.status?.state).toBe(
        TaskState.TASK_STATE_FAILED,
      );
      expect(JSON.stringify(event)).toContain("reconciliation");
    }
  });

  test("trusted cancellation is confirmed and durable unresolved contexts participate in close", async () => {
    let stopped: boolean | undefined;
    const f = fixture({
      publication: async (_r, _events, confirmed) => {
        stopped = confirmed;
      },
      unresolvedContexts: ["other"],
    });
    const executor = new LettaAgentExecutor(
      {
        runTurn: async () => {
          throw new LettaTurnCancelledError();
        },
      },
      10,
      undefined,
      f.durability,
    );
    await executor.execute(request(), f.bus);
    expect(stopped).toBe(true);
    const event = terminal(f.events)[0]!;
    expect(event.kind === "statusUpdate" && event.data.status?.state).toBe(
      TaskState.TASK_STATE_CANCELED,
    );
    expect((await executor.close()).unresolvedContextIds).toContain("other");
  });

  test("real SDK persists correlated final snapshots and interrupted cancellation without deadlock", async () => {
    for (const interrupt of [false, true]) {
      const directory = await mkdtemp(join(tmpdir(), "durable-executor-"));
      const durability = await DurableBinding.open({
        directory,
        bindingId: "fixture",
      });
      const executor = new LettaAgentExecutor(
        {
          runTurn: async (r) => {
            r.onAssistantText("one");
            r.onAssistantText("two");
            return {
              text: "onetwo",
              ...(interrupt ? { state: "input_required" as const } : {}),
            };
          },
        },
        100,
        undefined,
        durability,
      );
      try {
        const handler = new DefaultRequestHandler(
          card,
          durability.taskStore,
          executor,
        );
        const c = request().context;
        const result = await handler.sendMessage(params(), c);
        if (!("id" in result)) throw new Error("Expected Task");
        // Let execute observe the SDK save acknowledgment before cancellation.
        await new Promise((r) => setTimeout(r, 0));
        if (interrupt) {
          const cancellation = handler.cancelTask(
            { id: result.id, tenant: "tenant", metadata: undefined },
            c,
          );
          const canceled = await Promise.race([
            cancellation,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("cancel timeout")), 500),
            ),
          ]);
          expect(canceled.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
        }
        expect((await executor.close()).complete).toBe(true);
        const saved = await durability.taskStore.load(result.id, c);
        expect(saved?.status?.message?.messageId).toBeTruthy();
        expect(saved?.artifacts?.[0]?.parts).toHaveLength(2);
        expect(durability.unresolvedContexts).toEqual([]);
      } finally {
        await durability.close();
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  test("accept rejection makes no runner call and official blocking/stream handlers settle", async () => {
    for (const stream of [false, true]) {
      let calls = 0;
      const f = fixture({
        accept: async () => {
          throw new Error("private acceptance detail");
        },
      });
      const executor = new LettaAgentExecutor(
        {
          runTurn: async () => {
            calls++;
            return { text: "no" };
          },
        },
        10,
        undefined,
        f.durability,
      );
      const handler = new DefaultRequestHandler(
        card,
        new InMemoryTaskStore(),
        executor,
      );
      const response = stream
        ? (async () => {
            const events = [];
            for await (const event of handler.sendMessageStream(
              params(),
              new ServerCallContext(),
            ))
              events.push(event);
            return events;
          })()
        : handler.sendMessage(params(), new ServerCallContext());
      const outcome = await Promise.race([
        response.catch(() => "rejected"),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("timeout"), 500),
        ),
      ]);
      expect(outcome).not.toBe("timeout");
      expect(calls).toBe(0);
      expect(JSON.stringify(outcome)).not.toContain(
        "private acceptance detail",
      );
      await executor.close();
    }
  });
});
