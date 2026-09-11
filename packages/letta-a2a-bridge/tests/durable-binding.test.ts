import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Task, TaskState } from "@a2a-js/sdk";
import { ServerCallContext } from "@a2a-js/sdk/server";
import { DurableBinding } from "../src/durable-binding.js";
import { SqliteBindingStore } from "../src/sqlite-store.js";

const context = () =>
  new ServerCallContext({
    user: { isAuthenticated: true, userName: "owner" },
    tenant: "tenant",
  });
const task = () =>
  Task.fromJSON({
    id: "task",
    contextId: "context",
    status: { state: "TASK_STATE_SUBMITTED" },
    history: [
      { messageId: "message", role: "ROLE_USER", parts: [{ text: "do work" }] },
    ],
  });
const request = () => ({
  taskId: "task",
  contextId: "context",
  userMessage: task().history[0]!,
  context: context(),
});
const turn = () => ({
  taskId: "task",
  a2aContextId: JSON.stringify(["owner", "tenant", "context"]),
  messageId: "message",
  text: "do work",
  signal: new AbortController().signal,
  onAssistantText() {},
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "a2a-durable-"));
  const options = { directory, bindingId: "binding" };
  let state = await DurableBinding.open(options);
  return {
    get state() {
      return state;
    },
    async restart() {
      await state.close();
      state = await DurableBinding.open(options);
      return state;
    },
    async close() {
      await state.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function accept(state: DurableBinding) {
  await state.reserveMessage(request().userMessage, context());
  await state.accept(request(), task(), "artifact");
}

test("recovery preserves deduplication and proves accepted-undispatched work unsent", async () => {
  const f = await fixture();
  try {
    await accept(f.state);
    const state = await f.restart();
    const saved = await state.taskStore.load("task", context());
    expect(saved?.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(state.inspectRecovery()).toHaveLength(0);
    await expect(
      state.reserveMessage(request().userMessage, context()),
    ).rejects.toThrow("Duplicate");
  } finally {
    await f.close();
  }
});

test("send intent remains fenced across restarts and cancellation request is not stop proof", async () => {
  const f = await fixture();
  try {
    await accept(f.state);
    await f.state.dispatched(request());
    await f.state.execution.beforeTurn!(turn());
    await f.state.execution.beforeSend!(turn(), {
      agentId: "agent",
      conversationId: "conversation",
      otid: "message",
    });
    await f.state.execution.observe!(turn(), {
      type: "loop_status",
      status: "STREAMING",
      activeRunIds: ["observed-run"],
    });
    await f.state.execution.observe!(turn(), {
      type: "loop_status",
      status: "WAITING_ON_INPUT",
      activeRunIds: [],
    });
    const state = await f.restart();
    expect(state.inspectRecovery()).toHaveLength(1);
    expect(state.inspectRecovery()[0]?.runIds).toEqual(["observed-run"]);
    await expect(
      state.execution.beforeTurn!({ ...turn(), messageId: "next" }),
    ).rejects.toThrow("reconciliation");
    await state.requestCancellation("task", context());
    expect(
      (await state.taskStore.load("task", context()))?.status?.state,
    ).not.toBe(TaskState.TASK_STATE_CANCELED);
    expect(state.inspectRecovery()).toHaveLength(1);
    await f.restart();
    expect(f.state.inspectRecovery()[0]?.cancelRequested).toBe(true);
  } finally {
    await f.close();
  }
});

test("conversation mappings reject aliases and survive restart", async () => {
  const f = await fixture();
  try {
    await f.state.conversationMapping.set("scoped-one", "conversation");
    await expect(
      f.state.conversationMapping.set("scoped-two", "conversation"),
    ).rejects.toThrow("another");
    await f.restart();
    expect(await f.state.conversationMapping.get("scoped-one")).toBe(
      "conversation",
    );
  } finally {
    await f.close();
  }
});

test("stopped success repairs output once and retention keeps duplicate tombstones", async () => {
  const f = await fixture();
  try {
    await accept(f.state);
    await f.state.dispatched(request());
    await f.state.execution.beforeTurn!(turn());
    await f.state.execution.beforeSend!(turn(), {
      agentId: "agent",
      conversationId: "conversation",
      otid: "message",
    });
    await f.state.execution.observe!(turn(), {
      type: "assistant",
      content: "answer",
    } as any);
    await f.state.execution.observe!(turn(), {
      type: "result",
      success: true,
      result: "answer",
      runIds: ["run"],
    } as any);
    await f.state.execution.stopped!(turn());
    await f.restart();
    const first = await f.state.taskStore.load("task", context());
    expect(first?.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(first?.artifacts[0]?.parts[0]?.content).toEqual({
      $case: "text",
      value: "answer",
    });
    await f.restart();
    expect(await f.state.taskStore.load("task", context())).toEqual(first);
    expect(await f.state.prune(Date.now() + 1)).toBe(1);
    expect(await f.state.taskStore.load("task", context())).toBeUndefined();
    await expect(
      f.state.reserveMessage(request().userMessage, context()),
    ).rejects.toThrow("Duplicate");
  } finally {
    await f.close();
  }
});

test("unresolved snapshot stays stable and retention cannot remove its fence", async () => {
  const f = await fixture();
  try {
    await accept(f.state);
    await f.state.dispatched(request());
    await f.restart();
    const first = await f.state.taskStore.load("task", context());
    await f.restart();
    expect(await f.state.taskStore.load("task", context())).toEqual(first);
    expect(await f.state.prune(Date.now() + 1)).toBe(0);
    expect(f.state.inspectRecovery()).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("operator reconciliation requires exact attempt and conversation stop evidence", async () => {
  const f = await fixture();
  try {
    await accept(f.state);
    await f.state.dispatched(request());
    await f.state.execution.beforeTurn!(turn());
    await f.state.execution.beforeSend!(turn(), {
      agentId: "agent",
      conversationId: "conversation",
      otid: "message",
    });
    await f.restart();
    const record = f.state.inspectRecovery()[0]!;
    await expect(
      f.state.resolveWithVerifiedStop({
        attemptId: record.id,
        conversationId: "wrong",
        evidence: "checked",
        outcome: "failed",
      }),
    ).rejects.toThrow("Exact");
    await expect(
      f.state.resolveWithVerifiedStop({
        attemptId: record.id,
        conversationId: "conversation",
        evidence: "",
        outcome: "failed",
      }),
    ).rejects.toThrow("Exact");
    expect(f.state.inspectRecovery()).toHaveLength(1);
    await f.state.resolveWithVerifiedStop({
      attemptId: record.id,
      conversationId: "conversation",
      evidence:
        "fixture controller and backend execution independently stopped",
      outcome: "failed",
    });
    expect(f.state.inspectRecovery()).toHaveLength(0);
    await f.restart();
    expect(f.state.inspectRecovery()).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("malformed recovery records fail closed even in an intact SQLite database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "a2a-corrupt-journal-"));
  const options = { directory, bindingId: "binding" };
  try {
    const state = await DurableBinding.open(options);
    await accept(state);
    await state.close();
    const raw = await SqliteBindingStore.open(options);
    const [key, record] = raw.records<any>("executions")[0]!;
    raw.setRecord("executions", key, {
      ...record,
      phase: "done",
      stopped: false,
    });
    raw.close();
    await expect(DurableBinding.open(options)).rejects.toThrow(
      "Invalid recovery",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("journal admission bounds fail closed instead of forgetting deduplication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "a2a-bounded-journal-"));
  const state = await DurableBinding.open({
    directory,
    bindingId: "bounded",
    maxJournalEntries: 1,
  });
  try {
    await state.reserveMessage(request().userMessage, context());
    await expect(
      state.reserveMessage(
        { ...request().userMessage, messageId: "second" },
        context(),
      ),
    ).rejects.toThrow("limit");
    await expect(
      state.reserveMessage(request().userMessage, context()),
    ).rejects.toThrow("Duplicate");
  } finally {
    await state.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("admitted public output never doubles into an unreopenable recovery record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "a2a-sized-repair-"));
  const options = { directory, bindingId: "sized", maxRecordBytes: 4096 };
  let state = await DurableBinding.open(options);
  try {
    await accept(state);
    await state.dispatched(request());
    await state.execution.beforeTurn!(turn());
    await state.execution.beforeSend!(turn(), {
      agentId: "agent",
      conversationId: "conversation",
      otid: "message",
    });
    await state.execution.observe!(turn(), {
      type: "assistant",
      content: "x".repeat(2200),
    } as any);
    await state.execution.stopped!(turn());
    await state.close();
    state = await DurableBinding.open(options);
    expect((await state.taskStore.load("task", context()))?.status?.state).toBe(
      TaskState.TASK_STATE_COMPLETED,
    );
  } finally {
    await state.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("uncorrelated dispatch can only resolve using binding-wide verified stop evidence", async () => {
  const f = await fixture();
  try {
    await accept(f.state);
    await f.state.dispatched(request());
    await f.restart();
    const r = f.state.inspectRecovery()[0]!;
    await expect(
      f.state.resolveWithVerifiedStop({
        attemptId: r.id,
        evidence: "checked",
        outcome: "failed",
        bindingStopped: {
          bindingId: "wrong",
          evidence: "all execution stopped",
        },
      }),
    ).rejects.toThrow("Exact");
    await f.state.resolveWithVerifiedStop({
      attemptId: r.id,
      evidence: "attempt result unavailable",
      outcome: "failed",
      bindingStopped: {
        bindingId: "binding",
        evidence:
          "operator stopped and verified all runtimes/tools associated with this binding",
      },
    });
    expect(f.state.inspectRecovery()).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("concurrent admission cannot exceed maxTasks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "a2a-task-cap-"));
  const state = await DurableBinding.open({
    directory,
    bindingId: "cap",
    maxTasks: 1,
  });
  try {
    const second = task();
    second.id = "second";
    second.history[0]!.messageId = "second-message";
    const results = await Promise.allSettled([
      state.accept(request(), task(), "a"),
      state.accept(
        { ...request(), taskId: second.id, userMessage: second.history[0]! },
        second,
        "b",
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  } finally {
    await state.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("tiny streaming chunks are bounded by their actual SDK representation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "a2a-part-budget-"));
  const options = { directory, bindingId: "parts", maxRecordBytes: 16384 };
  let state = await DurableBinding.open(options);
  try {
    await accept(state);
    await state.dispatched(request());
    await state.execution.beforeTurn!(turn());
    await state.execution.beforeSend!(turn(), {
      agentId: "agent",
      conversationId: "conversation",
      otid: "message",
    });
    let admitted = 0;
    for (; admitted < 3900; admitted++) {
      try {
        await state.execution.observe!(turn(), {
          type: "assistant",
          content: "x",
        } as any);
      } catch (error) {
        expect(String(error)).toContain("size limit");
        break;
      }
    }
    expect(admitted).toBeGreaterThan(0);
    expect(admitted).toBeLessThan(3900);
    await state.execution.unresolved!(turn());
    await state.close();
    state = await DurableBinding.open(options);
    expect(state.inspectRecovery()).toHaveLength(1);
    expect(
      (await state.taskStore.load("task", context()))?.artifacts.length,
    ).toBe(1);
  } finally {
    await state.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("mandatory recovery bookkeeping cannot reject an admitted near-budget identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "a2a-metadata-budget-"));
  const options = { directory, bindingId: "metadata", maxRecordBytes: 1024 };
  let state = await DurableBinding.open(options);
  const c = new ServerCallContext({
    user: { isAuthenticated: true, userName: "owner" },
  });
  const initial = Task.fromJSON({
    id: "task370",
    contextId: "context",
    status: { state: "TASK_STATE_SUBMITTED" },
    history: [
      {
        messageId: "x".repeat(370),
        role: "ROLE_USER",
        parts: [{ text: "work" }],
      },
    ],
  });
  try {
    await state.reserveMessage(initial.history[0]!, c);
    await state.accept(
      {
        taskId: initial.id,
        contextId: initial.contextId,
        userMessage: initial.history[0]!,
        context: c,
      },
      initial,
      "artifact",
    );
    await state.close();
    state = await DurableBinding.open(options);
    expect((await state.taskStore.load(initial.id, c))?.status?.state).toBe(
      TaskState.TASK_STATE_FAILED,
    );
  } finally {
    await state.close();
    await rm(directory, { recursive: true, force: true });
  }
});
