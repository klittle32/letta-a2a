import { describe, expect, test } from "bun:test";
import {
  Message,
  Part,
  Task,
  TaskState,
  type Artifact,
  type TaskStatus,
  type StreamResponse,
} from "@a2a-js/sdk";
import { type Client } from "@a2a-js/sdk/client";
import {
  A2AInvocationError,
  A2AInvocationCancelledError,
  PollingA2AInvoker,
} from "../src/a2a-invoker.js";

function messageValue(value: Partial<Message>): Message {
  return { ...Message.fromJSON({}), ...value };
}
function partValue(value: Partial<Part>): Part {
  return { ...Part.fromJSON({}), ...value };
}
function taskValue(
  value: Omit<Partial<Task>, "status" | "artifacts"> & {
    status?: Partial<TaskStatus>;
    artifacts?: Partial<Artifact>[];
  },
): Task {
  return {
    ...Task.fromJSON({}),
    ...value,
    status: value.status
      ? {
          state: TaskState.TASK_STATE_UNSPECIFIED,
          timestamp: "",
          message: undefined,
          ...value.status,
        }
      : undefined,
    artifacts:
      value.artifacts?.map((artifact) => ({
        artifactId: "",
        name: "",
        description: "",
        parts: [],
        metadata: undefined,
        extensions: [],
        ...artifact,
      })) ?? [],
  };
}
const url = "https://agent.test";
const input = () => ({
  url,
  message: "work",
  signal: new AbortController().signal,
});
const task = (state = TaskState.TASK_STATE_WORKING) =>
  taskValue({
    id: "task-1",
    contextId: "context-1",
    status: { state },
  });
function client(methods: Partial<Client>): Client {
  return methods as Client;
}
function invoker(methods: Partial<Client>, timeoutMs = 150) {
  return new PollingA2AInvoker(async () => client(methods), {
    pollIntervalMs: 1,
    timeoutMs,
    cancelTimeoutMs: 20,
  });
}
const never = () => new Promise<never>(() => {});

import { bounded, Operation } from "../src/operation.js";

test("bounded removes its abort listener even if underlying work never settles", async () => {
  const controller = new AbortController();
  let removed = 0;
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.removeEventListener = (
    ...args: Parameters<AbortSignal["removeEventListener"]>
  ) => {
    removed++;
    remove(...args);
  };
  const pending = bounded(never, controller.signal).catch((error) => error);
  await Promise.resolve();
  controller.abort();
  await pending;
  expect(removed).toBe(1);
});

test("late synchronous settlement cannot beat a queued deadline timer", async () => {
  const deadline = performance.now() + 5;
  const operation = new Operation(1000, undefined, 0, deadline);
  const pending = operation.run(() => {
    while (performance.now() < deadline + 5) {
      // Deliberately hold the event loop past the deadline before resolving.
    }
    return "late success";
  });
  try {
    await expect(pending).rejects.toThrow("timed out");
  } finally {
    operation.close();
  }
});

test("cleanup does not start after the shared absolute deadline", async () => {
  const operation = new Operation(1000, undefined, 100, performance.now() + 10);
  await new Promise((resolve) => setTimeout(resolve, 20));
  let started = false;
  await operation.cleanup(async () => {
    started = true;
  }, 500);
  operation.close();
  expect(started).toBe(false);
});

for (const kind of [
  "task",
  "statusUpdate",
  "artifactUpdate",
  "message",
] as const) {
  test(`rejects foreign ${kind} stream identity before ownership or cancellation`, async () => {
    const foreign = { ...task(), id: "foreign" };
    const event =
      kind === "task"
        ? { payload: { $case: kind, value: foreign } }
        : kind === "message"
          ? {
              payload: {
                $case: kind,
                value: messageValue({
                  taskId: "foreign",
                  contextId: "context-1",
                }),
              },
            }
          : {
              payload: {
                $case: kind,
                value: {
                  taskId: "foreign",
                  contextId: "context-1",
                  status: undefined,
                  metadata: undefined,
                  artifact: undefined,
                  append: false,
                  lastChunk: false,
                },
              },
            };
    let hooks = 0;
    let cancellations = 0;
    const runner = invoker({
      async *sendMessageStream() {
        yield event;
      },
      async *resubscribeTask() {
        yield event;
      },
      cancelTask: async () => {
        cancellations++;
        return foreign;
      },
    });
    const error = await runner
      .stream({
        ...input(),
        taskId: "expected",
        onTask: async () => {
          hooks++;
        },
      })
      .next()
      .catch((e) => e);
    expect(error).toBeInstanceOf(A2AInvocationError);
    expect(error.task).toBeUndefined();
    expect(hooks).toBe(0);
    expect(cancellations).toBe(0);
    await expect(
      runner.subscribe(url, "expected").next(),
    ).rejects.toBeInstanceOf(A2AInvocationError);
  });

  test(`pins learned context before delivering subsequent ${kind} event`, async () => {
    const accepted = task();
    const changed = { ...accepted, contextId: "foreign-context" };
    const event =
      kind === "task"
        ? { payload: { $case: kind, value: changed } }
        : kind === "message"
          ? {
              payload: {
                $case: kind,
                value: messageValue({
                  taskId: accepted.id,
                  contextId: changed.contextId,
                }),
              },
            }
          : {
              payload: {
                $case: kind,
                value: {
                  taskId: accepted.id,
                  contextId: changed.contextId,
                  status: undefined,
                  metadata: undefined,
                  artifact: undefined,
                  append: false,
                  lastChunk: false,
                },
              },
            };
    const hooks: Task[] = [];
    const runner = invoker({
      async *sendMessageStream() {
        yield { payload: { $case: "task", value: accepted } };
        yield event;
      },
      async *resubscribeTask() {
        yield { payload: { $case: "task", value: accepted } };
        yield event;
      },
      cancelTask: async (request) => {
        expect(request.id).toBe(accepted.id);
        return changed;
      },
    });
    for (const stream of [
      runner.stream({
        ...input(),
        onTask: async (value) => {
          hooks.push(value);
        },
      }),
      runner.subscribe(url, accepted.id),
    ]) {
      await stream.next();
      const error = await stream.next().catch((e) => e);
      expect(error).toBeInstanceOf(A2AInvocationError);
      expect(error.task).toBe(accepted);
      expect(error.cancellation).toBeUndefined();
    }
    expect(hooks).toEqual([accepted]);
  });
}

test("rejects foreign unary task and cancellation readbacks", async () => {
  const foreign = { ...task(), id: "foreign" };
  let cancels = 0;
  const runner = invoker({
    sendMessage: async () => foreign,
    getTask: async () => foreign,
    cancelTask: async () => {
      cancels++;
      return foreign;
    },
  });
  const error = await runner
    .invoke({ ...input(), taskId: "expected" })
    .catch((e) => e);
  expect(error.task).toBeUndefined();
  expect(cancels).toBe(0);
  await expect(runner.getTask(url, "expected")).rejects.toBeInstanceOf(
    A2AInvocationError,
  );
  await expect(runner.cancelTask(url, "expected")).rejects.toBeInstanceOf(
    A2AInvocationError,
  );
});

test("learned polling context cannot change or replace accepted ownership", async () => {
  const accepted = task();
  const changed = { ...accepted, contextId: "foreign" };
  const hooks: Task[] = [];
  const error = await invoker({
    sendMessage: async () => accepted,
    getTask: async () => changed,
    cancelTask: async () => ({ ...accepted, id: "foreign" }),
  })
    .invoke({
      ...input(),
      onTask: async (value) => {
        hooks.push(value);
      },
    })
    .catch((e) => e);
  expect(error.task).toBe(accepted);
  expect(error.cancellation).toBeUndefined();
  expect(hooks).toEqual([accepted]);
});

for (const missing of [{ id: "" }, { contextId: "" }]) {
  test(`rejects missing task identity ${JSON.stringify(missing)} before ownership`, async () => {
    let hooks = 0;
    let cancellations = 0;
    const malformed = { ...task(), ...missing };
    const error = await invoker({
      sendMessage: async () => malformed,
      cancelTask: async () => {
        cancellations++;
        return malformed;
      },
    })
      .invoke({
        ...input(),
        onTask: async () => {
          hooks++;
        },
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(A2AInvocationError);
    expect(error.task).toBeUndefined();
    expect(hooks).toBe(0);
    expect(cancellations).toBe(0);
  });
}

test("discovery/setup consumes the remaining shared budget without submission", async () => {
  const deadline = performance.now() + 40;
  let sends = 0;
  const runner = new PollingA2AInvoker(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
      return client({
        sendMessage: async () => {
          sends++;
          return task();
        },
      });
    },
    { timeoutMs: 1000, pollIntervalMs: 1, cancelTimeoutMs: 500 },
  );
  const error = await runner.invoke({ ...input(), deadline }).catch((e) => e);
  expect(error.submissionAttempted).toBe(false);
  expect(performance.now()).toBeLessThan(deadline + 30);
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(sends).toBe(0);
});

test("a longer shared budget never extends the core's own deadline", async () => {
  const start = performance.now();
  let cleanupSignal: AbortSignal | undefined;
  const runner = new PollingA2AInvoker(
    async () =>
      client({
        sendMessage: async () => task(),
        getTask: never,
        cancelTask: (_request, options) => {
          cleanupSignal = options?.signal;
          return never();
        },
      }),
    { timeoutMs: 40, pollIntervalMs: 1, cancelTimeoutMs: 500 },
  );
  await runner.invoke({ ...input(), deadline: start + 1000 }).catch((e) => e);
  expect(cleanupSignal?.aborted).toBe(true);
  expect(performance.now() - start).toBeLessThan(100);
});

test("stream reads and cancellation share the caller's absolute budget", async () => {
  const deadline = performance.now() + 50;
  let cleanupSignal: AbortSignal | undefined;
  const runner = new PollingA2AInvoker(
    async () =>
      client({
        async *sendMessageStream() {
          yield { payload: { $case: "task", value: task() } };
          await never();
        },
        cancelTask: (_request, options) => {
          cleanupSignal = options?.signal;
          return never();
        },
      }),
    { timeoutMs: 1000, pollIntervalMs: 1, cancelTimeoutMs: 500 },
  );
  const stream = runner.stream({ ...input(), deadline });
  await stream.next();
  const error = await stream.next().catch((e) => e);
  expect(error.task?.id).toBe("task-1");
  expect(cleanupSignal?.aborted).toBe(true);
  expect(performance.now()).toBeLessThan(deadline + 40);
});

test("shared deadline includes prior queue delay and caps independent cleanup budget", async () => {
  const deadline = performance.now() + 80;
  await new Promise((resolve) => setTimeout(resolve, 35));
  let cleanupSignal: AbortSignal | undefined;
  let cleanupStarted = 0;
  const runner = new PollingA2AInvoker(
    async () =>
      client({
        sendMessage: async () => task(),
        getTask: never,
        cancelTask: (_request, options) => {
          cleanupStarted = performance.now();
          cleanupSignal = options?.signal;
          return never();
        },
      }),
    { timeoutMs: 1000, pollIntervalMs: 1, cancelTimeoutMs: 500 },
  );
  const error = await runner.invoke({ ...input(), deadline }).catch((e) => e);
  expect(error).toBeInstanceOf(A2AInvocationError);
  expect(cleanupStarted).toBeGreaterThan(0);
  expect(cleanupStarted).toBeLessThan(deadline);
  expect(cleanupSignal?.aborted).toBe(true);
  expect(performance.now()).toBeLessThan(deadline + 40);
});

test("expired shared deadline starts neither discovery nor cleanup", async () => {
  let discoveries = 0;
  const runner = new PollingA2AInvoker(
    async () => {
      discoveries++;
      return client({});
    },
    { timeoutMs: 1000, pollIntervalMs: 1 },
  );
  const error = await runner
    .invoke({ ...input(), deadline: performance.now() - 1 })
    .catch((e) => e);
  expect(error).toBeInstanceOf(A2AInvocationError);
  expect(error.submissionAttempted).toBe(false);
  expect(discoveries).toBe(0);
});

test("caller abort can use cleanup only until the shared deadline", async () => {
  const controller = new AbortController();
  const deadline = performance.now() + 50;
  let cleanupSignal: AbortSignal | undefined;
  const runner = new PollingA2AInvoker(
    async () =>
      client({
        sendMessage: async () => task(),
        cancelTask: (_request, options) => {
          cleanupSignal = options?.signal;
          return never();
        },
      }),
    { timeoutMs: 1000, pollIntervalMs: 1, cancelTimeoutMs: 500 },
  );
  const error = await runner
    .invoke({
      ...input(),
      deadline,
      signal: controller.signal,
      onTask: async () => {
        controller.abort();
      },
    })
    .catch((e) => e);
  expect(error).toBeInstanceOf(A2AInvocationCancelledError);
  expect(cleanupSignal?.aborted).toBe(true);
  expect(performance.now()).toBeLessThan(deadline + 40);
});

describe("lossless invocations", () => {
  test("returns immediate messages and multiple typed artifacts unchanged", async () => {
    const parts = [
      partValue({ content: { $case: "text", value: "hello" } }),
      partValue({
        content: { $case: "data", value: { nested: [1, true] } },
        metadata: { tag: "data" },
      }),
      partValue({
        content: { $case: "raw", value: Buffer.from([1, 2]) },
        mediaType: "image/png",
      }),
      partValue({
        content: { $case: "url", value: "https://files.test/a" },
        filename: "a",
      }),
    ];
    const message = messageValue({
      messageId: "response",
      parts,
      metadata: { key: "value" },
    });
    expect(
      await invoker({ sendMessage: async () => message }).invoke(input()),
    ).toBe(message);
    const completed = taskValue({
      ...task(TaskState.TASK_STATE_COMPLETED),
      artifacts: [
        { artifactId: "a", parts, metadata: { a: 1 } },
        { artifactId: "b", parts },
      ],
      status: { state: TaskState.TASK_STATE_COMPLETED, message },
      metadata: { task: true },
    });
    expect(
      await invoker({ sendMessage: async () => completed }).invoke(input()),
    ).toBe(completed);
  });

  test("awaits ownership before polling and subsequent snapshots before return", async () => {
    const accepted = task();
    const completed = task(TaskState.TASK_STATE_COMPLETED);
    const seen: Task[] = [];
    const result = await invoker({
      sendMessage: async (request) => {
        expect(request.configuration?.returnImmediately).toBe(true);
        return accepted;
      },
      getTask: async (request) => {
        expect(seen).toEqual([accepted]);
        expect(request).toEqual({
          tenant: "",
          id: accepted.id,
          historyLength: undefined,
        });
        return completed;
      },
    }).invoke({
      ...input(),
      onTask: async (snapshot) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        seen.push(snapshot);
      },
    });
    expect(result).toBe(completed);
    expect(seen).toEqual([accepted, completed]);
  });

  test("continues the same interrupted task without cancelling", async () => {
    let sends = 0;
    const original = messageValue({
      messageId: "stable",
      taskId: "task-1",
      contextId: "context-1",
      metadata: { keep: true },
    });
    const runner = invoker({
      sendMessage: async (request) => {
        sends++;
        expect(request.message).toEqual(original);
        return task(
          sends === 1
            ? TaskState.TASK_STATE_INPUT_REQUIRED
            : TaskState.TASK_STATE_COMPLETED,
        );
      },
    });
    expect(await runner.invoke({ ...input(), message: original })).toEqual(
      task(TaskState.TASK_STATE_INPUT_REQUIRED),
    );
    expect(
      await runner.invoke({
        ...input(),
        message: original,
        taskId: "task-1",
        contextId: "context-1",
      }),
    ).toEqual(task(TaskState.TASK_STATE_COMPLETED));
  });

  test("rejects conflicting explicit IDs before discovery or submission", async () => {
    let discoveries = 0;
    const runner = new PollingA2AInvoker(
      async () => {
        discoveries++;
        throw Error("secret");
      },
      { pollIntervalMs: 1, timeoutMs: 100 },
    );
    for (const overrides of [{ contextId: "other" }, { taskId: "other" }]) {
      const error = await runner
        .invoke({
          ...input(),
          message: messageValue({
            messageId: "m",
            contextId: "c",
            taskId: "t",
          }),
          ...overrides,
        })
        .catch((e) => e);
      expect(error).toBeInstanceOf(A2AInvocationError);
      expect(error.submissionAttempted).toBe(false);
    }
    expect(discoveries).toBe(0);
  });

  test("rejects a conflicting response context with accepted task correlation", async () => {
    const accepted = task();
    let owned: Task | undefined;
    let cancelled = false;
    const error = await invoker({
      sendMessage: async () => accepted,
      cancelTask: async () => {
        cancelled = true;
        return accepted;
      },
    })
      .invoke({
        ...input(),
        contextId: "different-context",
        onTask: async (value) => {
          owned = value;
        },
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(A2AInvocationError);
    expect(error.submissionAttempted).toBe(true);
    expect(error.task).toBeUndefined();
    expect(owned).toBeUndefined();
    expect(cancelled).toBe(false);
  });

  test("bounds discovery ignoring signals and distinguishes pre-send failure", async () => {
    const runner = new PollingA2AInvoker(never, {
      pollIntervalMs: 1,
      timeoutMs: 30,
    });
    const start = Date.now();
    const error = await runner.invoke(input()).catch((e) => e);
    expect(error).toBeInstanceOf(A2AInvocationError);
    expect(error.submissionAttempted).toBe(false);
    expect(Date.now() - start).toBeLessThan(200);
  });

  test("caller abort bounds hung hooks and keeps partial cancellation readback", async () => {
    const controller = new AbortController();
    const accepted = task();
    const partial = taskValue({
      ...accepted,
      artifacts: [{ artifactId: "partial" }],
    });
    const error = await invoker({
      sendMessage: async () => accepted,
      cancelTask: async () => partial,
    })
      .invoke({
        ...input(),
        signal: controller.signal,
        onTask: () => {
          controller.abort();
          return never();
        },
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(A2AInvocationCancelledError);
    expect(error.submissionAttempted).toBe(true);
    expect(error.task).toBe(accepted);
    expect(error.cancellation).toBe(partial);
    expect(error.message).not.toContain("confirmed");
  });

  test("bounds cancellation ignoring signal after a local failure; sanitizes error", async () => {
    let cancellations = 0;
    const start = Date.now();
    const error = await invoker({
      sendMessage: async () => task(),
      cancelTask: () => {
        cancellations++;
        return never();
      },
    })
      .invoke({
        ...input(),
        onTask: () => {
          throw Error("credential=secret");
        },
      })
      .catch((e) => e);
    expect(error.message).not.toContain("secret");
    expect(error.cause.message).toContain("secret");
    expect(error.messageId).toBeString();
    expect(error.cancellation).toBeUndefined();
    expect(cancellations).toBe(1);
    expect(Date.now() - start).toBeLessThan(200);
  });

  test("does not retry uncertain submission; honors caller abort", async () => {
    const controller = new AbortController();
    let sends = 0;
    const pending = invoker({
      sendMessage: () => {
        sends++;
        return never();
      },
    }).invoke({ ...input(), signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    const error = await pending.catch((e) => e);
    expect(error).toBeInstanceOf(A2AInvocationCancelledError);
    expect(error.submissionAttempted).toBe(true);
    expect(sends).toBe(1);
  });

  test("streams exact events, awaits accepted task, and closes on early break", async () => {
    const accepted = task();
    const event: StreamResponse = {
      payload: { $case: "task", value: accepted },
    };
    let closed = false;
    let owned = false;
    let cancelled = false;
    const runner = invoker({
      async *sendMessageStream() {
        try {
          yield event;
        } finally {
          closed = true;
        }
      },
      cancelTask: async () => {
        cancelled = true;
        return task(TaskState.TASK_STATE_CANCELED);
      },
    });
    for await (const received of runner.stream({
      ...input(),
      onTask: async () => {
        owned = true;
      },
    })) {
      expect(received).toBe(event);
      expect(owned).toBe(true);
      break;
    }
    expect(closed).toBe(true);
    expect(cancelled).toBe(true);
  });

  test("bounds streamed reads and iterator cleanup while preserving accepted ownership", async () => {
    let reads = 0;
    let closes = 0;
    const accepted = task();
    const source: AsyncGenerator<StreamResponse, void, undefined> = {
      next: () =>
        ++reads === 1
          ? Promise.resolve({
              done: false,
              value: { payload: { $case: "task", value: accepted } },
            })
          : never(),
      return: () => {
        closes++;
        return never();
      },
      throw: () => never(),
      [Symbol.asyncIterator]() {
        return this;
      },
      [Symbol.asyncDispose]: async () => {},
    };
    const runner = invoker(
      { sendMessageStream: () => source, cancelTask: never },
      40,
    );
    const start = Date.now();
    const stream = runner.stream(input());
    await stream.next();
    const error = await stream.next().catch((e) => e);
    expect(error).toBeInstanceOf(A2AInvocationError);
    expect(error.task).toBe(accepted);
    expect(error.submissionAttempted).toBe(true);
    expect(closes).toBe(1);
    expect(Date.now() - start).toBeLessThan(200);
  });

  test("poll timeout keeps the latest full snapshot and confirmed cancel readback", async () => {
    const accepted = task();
    const latest = taskValue({
      ...accepted,
      artifacts: [
        {
          artifactId: "partial",
          parts: [
            partValue({ content: { $case: "data", value: { progress: 2 } } }),
          ],
        },
      ],
    });
    const cancelled = taskValue({
      ...latest,
      status: { state: TaskState.TASK_STATE_CANCELED },
    });
    let polls = 0;
    const error = await invoker(
      {
        sendMessage: async () => accepted,
        getTask: () => (++polls === 1 ? Promise.resolve(latest) : never()),
        cancelTask: async () => cancelled,
      },
      40,
    )
      .invoke(input())
      .catch((e) => e);
    expect(error).toBeInstanceOf(A2AInvocationError);
    expect(error.task).toBe(latest);
    expect(error.cancellation).toBe(cancelled);
  });

  test("pre-aborted calls never discover or submit", async () => {
    let discoveries = 0;
    const controller = new AbortController();
    controller.abort();
    const runner = new PollingA2AInvoker(
      async () => {
        discoveries++;
        return client({});
      },
      { timeoutMs: 100, pollIntervalMs: 1 },
    );
    const error = await runner
      .invoke({ ...input(), signal: controller.signal })
      .catch((e) => e);
    expect(error).toBeInstanceOf(A2AInvocationCancelledError);
    expect(error.submissionAttempted).toBe(false);
    expect(discoveries).toBe(0);
  });

  test("standalone methods and subscription use full official requests", async () => {
    const snapshot = { ...task(), id: "t" };
    const event: StreamResponse = {
      payload: { $case: "task", value: snapshot },
    };
    const fake = client({
      getTask: async (request) => {
        expect(request).toEqual({
          tenant: "",
          id: "t",
          historyLength: undefined,
        });
        return snapshot;
      },
      cancelTask: async (request) => {
        expect(request).toEqual({ tenant: "", id: "t", metadata: undefined });
        return snapshot;
      },
      async *resubscribeTask(request) {
        expect(request).toEqual({ tenant: "", id: "t" });
        yield event;
      },
    });
    const runner = new PollingA2AInvoker(async () => fake, {
      pollIntervalMs: 1,
      timeoutMs: 100,
    });
    expect(await runner.connect(url)).toBe(fake);
    expect(await runner.getTask(url, "t")).toBe(snapshot);
    expect(await runner.cancelTask(url, "t")).toBe(snapshot);
    const events = [];
    for await (const value of runner.subscribe(url, "t")) events.push(value);
    expect(events).toEqual([event]);
  });
});
