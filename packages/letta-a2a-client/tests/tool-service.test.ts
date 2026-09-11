import { describe, expect, spyOn, test } from "bun:test";
import type { Client } from "@a2a-js/sdk/client";
import { Message, Role, Task, TaskState } from "@a2a-js/sdk";
import type { A2AInvocation, A2AInvoker } from "../src/a2a-invoker.js";
import { A2AInvocationError, PollingA2AInvoker } from "../src/a2a-invoker.js";
import {
  FileContextStore,
  MemoryContextStore,
  type ContextStore,
} from "../src/context-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { A2AToolService } from "../src/tool-service.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function task(
  id = "t1",
  contextId = "c1",
  state = TaskState.TASK_STATE_COMPLETED,
): Task {
  return Task.fromJSON({ id, contextId, status: { state } });
}
function fixture(store: ContextStore = new MemoryContextStore()) {
  const calls: A2AInvocation[] = [];
  let send = async (i: A2AInvocation) =>
    task(`t${calls.length}`, i.contextId || `c${calls.length}`);
  let read = async (id: string) => task(id);
  const invoker = {
    invoke: async (i: A2AInvocation) => {
      calls.push(i);
      const t = await send(i);
      await i.onTask?.(t);
      return t;
    },
    getTask: async (_url: string, id: string) => read(id),
    cancelTask: async (_url: string, id: string) =>
      task(id, "c1", TaskState.TASK_STATE_CANCELED),
    connect: async () => ({}),
  } as unknown as A2AInvoker;
  const routes = {
    peer: "https://example.test/a2a",
    alias: "https://example.test/a2a",
  };
  const service = new A2AToolService(routes, invoker, store);
  const input = (extra = {}) => ({
    target: "peer",
    localScope: "scope",
    message: "hello",
    signal: new AbortController().signal,
    ...extra,
  });
  return {
    calls,
    invoker,
    routes,
    service,
    store,
    input,
    send: (fn: typeof send) => {
      send = fn;
    },
    read: (fn: typeof read) => {
      read = fn;
    },
  };
}

describe("A2AToolService ownership", () => {
  test("owner drain waits for actual work after the caller has returned", async () => {
    const f = fixture();
    const entered = deferred();
    const finish = deferred();
    const owner = new AbortController();
    f.send(async () => {
      entered.resolve();
      await finish.promise;
      return task();
    });
    const call = f.service.invoke(f.input({ signal: owner.signal }));
    await entered.promise;
    owner.abort();
    await expect(call).rejects.toThrow();
    try {
      let drained = false;
      const drain = f.service.drain(owner.signal).then(() => {
        drained = true;
      });
      await f.service.drain(new AbortController().signal);
      expect(drained).toBe(false);
      finish.resolve();
      await drain;
      expect(drained).toBe(true);
    } finally {
      finish.resolve();
    }
  });

  test("same binding and endpoint aliases continue; retargeting does not", async () => {
    const f = fixture();
    await f.service.invoke(f.input());
    await f.service.invoke(f.input({ target: "alias" }));
    expect(f.calls[1]?.contextId).toBe("c1");
    f.routes.peer = "https://other.test/a2a";
    await f.service.invoke(f.input());
    expect(f.calls[2]?.contextId).toBeUndefined();
  });

  test("first-context concurrent calls serialize across service instances", async () => {
    const f = fixture();
    const entered = deferred();
    const finish = deferred();
    f.send(async (i) => {
      if (f.calls.length === 1) {
        entered.resolve();
        await finish.promise;
      }
      return task(`t${f.calls.length}`, i.contextId || "c1");
    });
    const first = f.service.invoke(f.input());
    await entered.promise;
    const other = new A2AToolService(f.routes, f.invoker, f.store);
    const second = other.invoke(f.input());
    finish.resolve();
    await Promise.all([first, second]);
    expect(f.calls[1]?.contextId).toBe("c1");
  });

  test("explicit same remote context across scopes is serialized", async () => {
    const queued = deferred();
    class ObservedStore extends MemoryContextStore {
      private executionWaiters = 0;
      override withLock<T>(
        key: string,
        signal: AbortSignal,
        work: () => Promise<T>,
      ): Promise<T> {
        if (
          JSON.parse(key)[0] === "a2a-execution" &&
          ++this.executionWaiters === 2
        )
          queued.resolve();
        return super.withLock(key, signal, work);
      }
    }
    const f = fixture(new ObservedStore());
    const entered = deferred();
    const finish = deferred();
    f.send(async (i) => {
      if (f.calls.length === 1) {
        entered.resolve();
        await finish.promise;
      }
      return task(`t${f.calls.length}`, i.contextId);
    });
    const first = f.service.invoke(f.input({ contextId: "shared" }));
    await entered.promise;
    const second = f.service.invoke(
      f.input({ contextId: "shared", localScope: "other" }),
    );
    await queued.promise;
    expect(f.calls).toHaveLength(1);
    finish.resolve();
    await Promise.all([first, second]);
  });

  test("canceled waiter never sends and does not unblock another waiter", async () => {
    const f = fixture();
    const entered = deferred();
    const finish = deferred();
    f.send(async (i) => {
      if (f.calls.length === 1) {
        entered.resolve();
        await finish.promise;
      }
      return task(`t${f.calls.length}`, i.contextId || "c1");
    });
    const first = f.service.invoke(f.input());
    await entered.promise;
    const controller = new AbortController();
    const second = f.service.invoke(f.input({ signal: controller.signal }));
    controller.abort();
    await expect(second).rejects.toThrow();
    const third = f.service.invoke(f.input());
    expect(f.calls).toHaveLength(1);
    finish.resolve();
    await Promise.all([first, third]);
    expect(f.calls).toHaveLength(2);
  });

  test("interrupted work allows only same-task followup, terminal continuation rejects", async () => {
    const f = fixture();
    f.send(async () => task("t1", "c1", TaskState.TASK_STATE_INPUT_REQUIRED));
    f.read(async (id) => task(id, "c1", TaskState.TASK_STATE_INPUT_REQUIRED));
    await f.service.invoke(f.input());
    await expect(f.service.invoke(f.input())).rejects.toThrow(
      /same.task|taskId|task_id/i,
    );
    await f.service.invoke(f.input({ taskId: "t1" }));
    f.read(async (id) => task(id));
    await expect(f.service.invoke(f.input({ taskId: "t1" }))).rejects.toThrow(
      /terminal/i,
    );
  });

  test("accepted IDs survive failure and service reopen; working readback blocks sends", async () => {
    const f = fixture();
    f.send(async (i) => {
      const t = task("accepted", "remote", TaskState.TASK_STATE_WORKING);
      await i.onTask?.(t);
      throw new A2AInvocationError("lost", {
        submissionAttempted: true,
        task: t,
      });
    });
    await expect(f.service.invoke(f.input())).rejects.toThrow("lost");
    const reopened = new A2AToolService(f.routes, f.invoker, f.store);
    f.read(async (id) => task(id, "remote", TaskState.TASK_STATE_WORKING));
    await expect(reopened.invoke(f.input())).rejects.toThrow(
      /working|unresolved|active/i,
    );
    expect(f.calls).toHaveLength(1);
    f.read(async (id) => task(id, "remote"));
    f.send(async (i) => task("next", i.contextId));
    await reopened.invoke(f.input());
    expect(f.calls[1]?.contextId).toBe("remote");
  });

  test("unknown initial submission is quarantined even with new_context", async () => {
    const f = fixture();
    f.send(async () => {
      throw new A2AInvocationError("unknown", { submissionAttempted: true });
    });
    await expect(f.service.invoke(f.input())).rejects.toThrow();
    const reopened = new A2AToolService(f.routes, f.invoker, f.store);
    await expect(
      reopened.invoke(f.input({ newContext: true })),
    ).rejects.toThrow(/unknown|unresolved/i);
    expect(f.calls).toHaveLength(1);
  });

  test("legacy context requires explicit migration and remains preserved", async () => {
    const f = fixture();
    await f.store.set("scope/peer", "legacy-context");
    await expect(f.service.invoke(f.input())).rejects.toThrow(/legacy-context/);
    await f.service.invoke(f.input({ contextId: "legacy-context" }));
    expect(await f.store.get("scope/peer")).toBe("legacy-context");
  });

  test("get and cancel bypass active invocation locks", async () => {
    const f = fixture();
    const entered = deferred();
    const finish = deferred();
    f.send(async (i) => {
      await i.onTask?.(task("t1", "c1", TaskState.TASK_STATE_WORKING));
      entered.resolve();
      await finish.promise;
      return task();
    });
    const invocation = f.service.invoke(f.input());
    await entered.promise;
    expect(
      (
        await f.service.task({
          target: "peer",
          localScope: "scope",
          taskId: "t1",
          action: "get",
        })
      ).id,
    ).toBe("t1");
    expect(
      (
        await f.service.task({
          target: "peer",
          localScope: "scope",
          taskId: "t1",
          action: "cancel",
        })
      ).status?.state,
    ).toBe(TaskState.TASK_STATE_CANCELED);
    finish.resolve();
    await invocation;
  });

  test("file-backed acceptance journal survives a new store and service", async () => {
    const directory = await mkdtemp(join(tmpdir(), "a2a-service-"));
    try {
      const path = join(directory, "contexts.json");
      const f = fixture(new FileContextStore(path));
      f.send(async (i) => {
        const accepted = task(
          "durable",
          "disk-context",
          TaskState.TASK_STATE_WORKING,
        );
        await i.onTask?.(accepted);
        throw new A2AInvocationError("disconnect", {
          submissionAttempted: true,
          task: accepted,
        });
      });
      await expect(f.service.invoke(f.input())).rejects.toThrow("disconnect");
      f.read(async (id) => task(id, "disk-context"));
      f.send(async (i) => task("next", i.contextId));
      const reopened = new A2AToolService(
        f.routes,
        f.invoker,
        new FileContextStore(path),
      );
      await reopened.invoke(f.input());
      expect(f.calls[1]?.contextId).toBe("disk-context");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("caller abort returns accepted IDs but does not pretend work stopped", async () => {
    const f = fixture();
    const entered = deferred();
    const finish = deferred();
    const controller = new AbortController();
    f.send(async (i) => {
      await i.onTask?.(task("active", "c1", TaskState.TASK_STATE_WORKING));
      entered.resolve();
      await finish.promise;
      return task("active", "c1", TaskState.TASK_STATE_WORKING);
    });
    const running = f.service.invoke(f.input({ signal: controller.signal }));
    await entered.promise;
    controller.abort();
    const error = await running.catch((e) => e);
    expect(error.task.id).toBe("active");
    expect(error.messageId).toBeTruthy();
    expect(error.submissionAttempted).toBe(true);
    finish.resolve();
    f.read(async (id) => task(id, "c1", TaskState.TASK_STATE_WORKING));
    await expect(f.service.invoke(f.input())).rejects.toThrow(
      /working|unresolved/i,
    );
    expect(f.calls).toHaveLength(1);
  });

  test("only authoritative canceled readback releases accepted work", async () => {
    const f = fixture();
    f.send(async (i) => {
      const accepted = task("active", "c1", TaskState.TASK_STATE_WORKING);
      await i.onTask?.(accepted);
      throw new A2AInvocationError("cancel pending", {
        submissionAttempted: true,
        task: accepted,
        cancellation: accepted,
      });
    });
    await expect(f.service.invoke(f.input())).rejects.toThrow("cancel pending");
    f.read(async (id) => task(id, "c1", TaskState.TASK_STATE_WORKING));
    await expect(f.service.invoke(f.input())).rejects.toThrow(
      /working|unresolved/i,
    );
    f.read(async (id) => task(id, "c1", TaskState.TASK_STATE_CANCELED));
    f.send(async (i) => task("next", i.contextId));
    await f.service.invoke(f.input());
    expect(f.calls).toHaveLength(2);
  });

  test("mismatched readback fails closed without another send", async () => {
    const f = fixture();
    f.send(async () => task("active", "c1", TaskState.TASK_STATE_WORKING));
    await f.service.invoke(f.input());
    f.read(async () => task("foreign", "foreign-context"));
    await expect(f.service.invoke(f.input())).rejects.toThrow(
      /identity mismatch/,
    );
    expect(f.calls).toHaveLength(1);
    await expect(
      f.service.task({
        target: "peer",
        localScope: "scope",
        taskId: "active",
        action: "get",
      }),
    ).rejects.toThrow(/identity mismatch/);
  });

  test("known outstanding work can branch independently with new_context", async () => {
    const f = fixture();
    f.send(async () => task("active", "c1", TaskState.TASK_STATE_WORKING));
    await f.service.invoke(f.input());
    f.send(async () => task("independent", "c2"));
    await f.service.invoke(f.input({ newContext: true }));
    expect(f.calls[1]?.contextId).toBeUndefined();
    f.read(async (id) => task(id, "c1", TaskState.TASK_STATE_WORKING));
    await expect(
      f.service.invoke(f.input({ contextId: "c1" })),
    ).rejects.toThrow(/working|unresolved/i);
  });

  test("connect is bounded by close and targets are configured aliases", async () => {
    const f = fixture();
    const entered = deferred();
    const finish = deferred<never>();
    f.invoker.connect = async (_url, signal) => {
      entered.resolve();
      await finish.promise;
      signal?.throwIfAborted();
      return {} as never;
    };
    expect(f.service.targets()).toEqual(["alias", "peer"]);
    const connection = f.service.connect("peer");
    await entered.promise;
    f.service.close();
    await expect(connection).rejects.toThrow(/cancelled/);
    await expect(f.service.invoke(f.input())).rejects.toThrow(/cancelled/);
    expect(f.calls).toHaveLength(0);
  });

  test("official structured messages retain parts and correlation ID", async () => {
    const f = fixture();
    const message = Message.fromJSON({
      messageId: "caller-message",
      role: Role.ROLE_USER,
      parts: [{ text: "hello" }, { data: { nested: 1 } }],
    });
    await f.service.invoke(f.input({ message }));
    expect(f.calls[0]?.message).toEqual(message);
  });

  test("pending message ID is durable before send and payload is not stored", async () => {
    const f = fixture();
    f.send(async (i) => {
      const record = await f.store.get(
        JSON.stringify(["a2a-binding", "scope", f.routes.peer]),
      );
      expect(JSON.parse(record!)).toEqual({
        messageId: (i.message as Message).messageId,
        pending: true,
        submissionUnknown: true,
      });
      expect(record).not.toContain("sensitive message");
      return task();
    });
    await f.service.invoke(f.input({ message: "sensitive message" }));
  });

  test("definitive pre-submission failure is safe to retry", async () => {
    const f = fixture();
    f.send(async () => {
      throw new A2AInvocationError("discovery failed", {
        submissionAttempted: false,
      });
    });
    await expect(f.service.invoke(f.input())).rejects.toThrow(
      "discovery failed",
    );
    f.send(async () => task());
    await f.service.invoke(f.input());
    expect(f.calls).toHaveLength(2);
  });

  test("official Message response is returned unchanged and supplies continuity", async () => {
    const f = fixture();
    const reply = Message.fromJSON({
      messageId: "reply",
      contextId: "message-context",
      role: Role.ROLE_AGENT,
      parts: [{ text: "hello" }],
    });
    const normalInvoke = f.invoker.invoke;
    f.invoker.invoke = async () => reply;
    expect(await f.service.invoke(f.input())).toBe(reply);
    f.invoker.invoke = normalInvoke;
    await f.service.invoke(f.input());
    expect(f.calls[0]?.contextId).toBe("message-context");
  });

  test("started persistence keeps ownership through abort and cancellation is last", async () => {
    const writeStarted = deferred();
    const releaseWrite = deferred();
    const queued = deferred();
    const binding = JSON.stringify([
      "a2a-binding",
      "scope",
      "https://example.test/a2a",
    ]);
    const execution = JSON.stringify([
      "a2a-execution",
      "https://example.test/a2a",
      "c1",
    ]);
    let block = true;
    let ownershipReleased = false;
    let cancellationWritten = false;
    class DelayedStore extends MemoryContextStore {
      override async set(key: string, value: string) {
        if (
          key === execution &&
          JSON.parse(value).state === TaskState.TASK_STATE_WORKING &&
          block
        ) {
          block = false;
          writeStarted.resolve();
          await releaseWrite.promise;
        }
        await super.set(key, value);
        if (
          key === execution &&
          JSON.parse(value).state === TaskState.TASK_STATE_CANCELED
        )
          cancellationWritten = true;
      }
      override withLock<T>(
        key: string,
        signal: AbortSignal,
        work: () => Promise<T>,
      ): Promise<T> {
        if (key === binding && block === false) queued.resolve();
        return super.withLock(key, signal, async () => {
          try {
            return await work();
          } finally {
            if (key === binding) ownershipReleased = true;
          }
        });
      }
    }
    const f = fixture(new DelayedStore());
    const caller = new AbortController();
    const coreExited = deferred();
    const normal = f.invoker.invoke;
    let hook!: Promise<void>;
    f.invoker.invoke = async (i) => {
      hook = Promise.resolve(
        i.onTask?.(task("t1", "c1", TaskState.TASK_STATE_WORKING)),
      );
      await new Promise<void>((resolve) =>
        i.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      coreExited.resolve();
      throw new A2AInvocationError("aborted", {
        submissionAttempted: true,
        task: task("t1", "c1", TaskState.TASK_STATE_WORKING),
        cancellation: task("t1", "c1", TaskState.TASK_STATE_CANCELED),
      });
    };
    const first = f.service.invoke(f.input({ signal: caller.signal }));
    await writeStarted.promise;
    caller.abort();
    await expect(first).rejects.toThrow();
    await coreExited.promise;
    f.invoker.invoke = normal;
    const next = f.service.invoke(f.input({ taskId: "t1" }));
    await queued.promise;
    // A storage read is a deterministic yield; the delayed write is still held.
    await f.store.get(binding);
    expect(ownershipReleased).toBe(false);
    expect(cancellationWritten).toBe(false);
    expect(f.calls).toHaveLength(0);
    releaseWrite.resolve();
    await hook;
    // The successor can only inspect/reject continuation after cancellation is durable.
    await expect(next).rejects.toThrow(/terminal/);
    expect(f.calls).toHaveLength(0);
    // Acquire the binding behind cleanup to observe its final durable state.
    await f.store.withLock(binding, new AbortController().signal, async () => {
      expect(JSON.parse((await f.store.get(execution))!).state).toBe(
        TaskState.TASK_STATE_CANCELED,
      );
      expect(cancellationWritten).toBe(true);
    });
  });

  test("ambiguous same-task continuation is quarantined across reopen", async () => {
    const f = fixture();
    f.send(async () => task("t1", "c1", TaskState.TASK_STATE_INPUT_REQUIRED));
    f.read(async (id) => task(id, "c1", TaskState.TASK_STATE_INPUT_REQUIRED));
    await f.service.invoke(f.input());
    f.send(async () => {
      throw new A2AInvocationError("response lost", {
        submissionAttempted: true,
      });
    });
    await expect(f.service.invoke(f.input({ taskId: "t1" }))).rejects.toThrow(
      "response lost",
    );
    f.send(async () => task("t1", "c1", TaskState.TASK_STATE_INPUT_REQUIRED));
    const reopened = new A2AToolService(f.routes, f.invoker, f.store);
    await expect(reopened.invoke(f.input({ taskId: "t1" }))).rejects.toThrow(
      /unknown.*submission|submission.*unknown/i,
    );
    await expect(
      reopened.invoke(f.input({ newContext: true })),
    ).rejects.toThrow(/unknown.*submission|submission.*unknown/i);
    await expect(
      reopened.invoke(
        f.input({ localScope: "other", contextId: "c1", taskId: "t1" }),
      ),
    ).rejects.toThrow(/unknown.*submission|submission.*unknown/i);
    expect(f.calls).toHaveLength(2);
  });

  test("unknown targets never submit and new_context preserves legacy entries", async () => {
    const f = fixture();
    await expect(
      f.service.invoke(f.input({ target: "missing" })),
    ).rejects.toThrow('Unknown A2A target "missing"');
    expect(f.calls).toHaveLength(0);
    await f.store.set("scope/peer", "old-context");
    await f.service.invoke(f.input({ newContext: true }));
    expect(f.calls[0]?.contextId).toBeUndefined();
    await f.service.invoke(f.input());
    expect(f.calls[1]?.contextId).toBe("c1");
    expect(await f.store.get("scope/peer")).toBe("old-context");
  });

  test("queued service passes its original deadline and core cannot start cleanup after it", async () => {
    let now = 1_000;
    const clock = spyOn(performance, "now").mockImplementation(() => now);
    const entered = deferred();
    const release = deferred();
    const queued = deferred();
    const key = JSON.stringify([
      "a2a-binding",
      "scope",
      "https://example.test/a2a",
    ]);
    let lockRequests = 0;
    let submissions = 0;
    let cancellations = 0;
    let observedDeadline: number | undefined;
    class QueuedStore extends MemoryContextStore {
      override withLock<T>(
        key: string,
        signal: AbortSignal,
        work: () => Promise<T>,
      ): Promise<T> {
        if (++lockRequests === 2) queued.resolve();
        return super.withLock(key, signal, work);
      }
    }
    const store = new QueuedStore();
    const f = fixture(store);
    const holder = store.withLock(
      key,
      new AbortController().signal,
      async () => {
        entered.resolve();
        await release.promise;
      },
    );
    const client = {
      sendMessage: async () => {
        submissions++;
        return task("t1", "c1", TaskState.TASK_STATE_WORKING);
      },
      cancelTask: async () => {
        cancellations++;
        return task("t1", "c1", TaskState.TASK_STATE_CANCELED);
      },
    } as unknown as Client;
    const core = new PollingA2AInvoker(async () => client, {
      timeoutMs: 10_000,
      pollIntervalMs: 0,
      cancelTimeoutMs: 1_000,
    });
    f.invoker.invoke = (input) => {
      observedDeadline = input.deadline;
      return core.invoke({
        ...input,
        onTask: async (snapshot) => {
          await input.onTask?.(snapshot);
          // Advance the monotonic clock beyond the shared bound, with no sleeps.
          now = 1_101;
        },
      });
    };
    const service = new A2AToolService(f.routes, f.invoker, store, {
      timeoutMs: 100,
    });
    try {
      await entered.promise;
      const result = service.invoke(f.input());
      await queued.promise;
      now = 1_080;
      release.resolve();
      await holder;
      await expect(result).rejects.toThrow(/timed out/);
      expect(observedDeadline).toBe(1_100);
      expect(submissions).toBe(1);
      expect(cancellations).toBe(0);
    } finally {
      release.resolve();
      service.close();
      clock.mockRestore();
    }
  });

  test("whole-operation timeout includes queued lock wait", async () => {
    const f = fixture();
    const entered = deferred();
    const finish = deferred();
    f.send(async () => {
      entered.resolve();
      await finish.promise;
      return task();
    });
    const first = f.service.invoke(f.input());
    await entered.promise;
    const short = new A2AToolService(f.routes, f.invoker, f.store, {
      timeoutMs: 10,
    });
    await expect(short.invoke(f.input())).rejects.toThrow(/timed out/i);
    expect(f.calls).toHaveLength(1);
    finish.resolve();
    await first;
  });
});
