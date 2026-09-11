import { describe, expect, test } from "bun:test";
import {
  Role,
  type Message,
  type Task,
  TaskState,
} from "@a2a-js/sdk";

import {
  PollingA2AInvoker,
  type A2AClient,
} from "../src/a2a-invoker.js";

describe("PollingA2AInvoker", () => {
  test("polls an asynchronous task and returns its text artifact", async () => {
    const client = new FakeA2AClient(
      task(TaskState.TASK_STATE_SUBMITTED),
      [
        task(TaskState.TASK_STATE_WORKING),
        task(TaskState.TASK_STATE_COMPLETED, "finished"),
      ],
    );
    const invoker = new PollingA2AInvoker(async () => client, {
      pollIntervalMs: 1,
      timeoutMs: 1_000,
    });

    const result = await invoker.invoke({
      url: "http://example.test",
      message: "do the work",
      contextId: "remote-context",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      ok: true,
      status: "completed",
      taskId: "task-1",
      contextId: "remote-context",
      text: "finished",
    });
    expect(client.sentContextId).toBe("remote-context");
    expect(client.getCalls).toBe(2);
  });

  test("returns an immediate A2A message without polling", async () => {
    const client = new FakeA2AClient(message("immediate"), []);
    const invoker = new PollingA2AInvoker(async () => client, {
      pollIntervalMs: 1,
      timeoutMs: 1_000,
    });

    const result = await invoker.invoke({
      url: "http://example.test",
      message: "hello",
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      contextId: "remote-context",
      text: "immediate",
    });
    expect(client.getCalls).toBe(0);
  });

  test("cancels an accepted task when the caller aborts", async () => {
    const client = new FakeA2AClient(
      task(TaskState.TASK_STATE_SUBMITTED),
      [task(TaskState.TASK_STATE_WORKING)],
    );
    const invoker = new PollingA2AInvoker(async () => client, {
      pollIntervalMs: 50,
      timeoutMs: 1_000,
    });
    const cancellation = new AbortController();

    const pending = invoker.invoke({
      url: "http://example.test",
      message: "wait",
      signal: cancellation.signal,
    });
    setTimeout(() => cancellation.abort(), 5);

    await expect(pending).rejects.toThrow("A2A invocation was cancelled");
    expect(client.cancelledTaskId).toBe("task-1");
  });

  test("cancels an accepted task when its polling budget expires", async () => {
    const client = new FakeA2AClient(
      task(TaskState.TASK_STATE_SUBMITTED),
      [task(TaskState.TASK_STATE_WORKING)],
    );
    const invoker = new PollingA2AInvoker(async () => client, {
      pollIntervalMs: 50,
      timeoutMs: 10,
    });

    await expect(
      invoker.invoke({
        url: "http://example.test",
        message: "wait",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("A2A invocation exceeded 0 seconds");
    expect(client.cancelledTaskId).toBe("task-1");
  });

  test("preserves a remote terminal failure as a structured result", async () => {
    const client = new FakeA2AClient(task(TaskState.TASK_STATE_FAILED), []);
    const invoker = new PollingA2AInvoker(async () => client, {
      pollIntervalMs: 1,
      timeoutMs: 1_000,
    });

    const result = await invoker.invoke({
      url: "http://example.test",
      message: "fail",
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      taskId: "task-1",
      contextId: "remote-context",
    });
  });
});

class FakeA2AClient implements A2AClient {
  getCalls = 0;
  cancelledTaskId?: string;
  sentContextId?: string;

  constructor(
    private readonly sent: Message | Task,
    private readonly polled: Task[],
  ) {}

  async sendMessage(request: {
    message?: Message;
  }): Promise<Message | Task> {
    this.sentContextId = request.message?.contextId || undefined;
    return this.sent;
  }

  async getTask(): Promise<Task> {
    const result = this.polled[Math.min(this.getCalls, this.polled.length - 1)];
    this.getCalls += 1;
    if (!result) throw new Error("No fake task configured");
    return result;
  }

  async cancelTask(request: { id: string }): Promise<Task> {
    this.cancelledTaskId = request.id;
    return task(TaskState.TASK_STATE_CANCELED);
  }
}

function task(state: TaskState, text?: string): Task {
  return {
    id: "task-1",
    contextId: "remote-context",
    status: { state, timestamp: new Date().toISOString(), message: undefined },
    artifacts: text
      ? [
          {
            artifactId: "artifact-1",
            name: "result",
            description: "",
            parts: [part(text)],
            metadata: undefined,
            extensions: [],
          },
        ]
      : [],
    history: [],
    metadata: undefined,
  };
}

function message(text: string): Message {
  return {
    messageId: "message-1",
    contextId: "remote-context",
    taskId: "",
    role: Role.ROLE_AGENT,
    parts: [part(text)],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

function part(text: string) {
  return {
    content: { $case: "text" as const, value: text },
    metadata: undefined,
    filename: "",
    mediaType: "text/plain",
  };
}
