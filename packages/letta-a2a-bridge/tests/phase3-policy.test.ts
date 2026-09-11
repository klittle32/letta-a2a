import { test, expect } from "bun:test";
import {
  Role,
  TaskState,
  SendMessageRequest,
  GetTaskRequest,
  ListTasksRequest,
  TaskPushNotificationConfig,
  GetTaskPushNotificationConfigRequest,
} from "@a2a-js/sdk";
import {
  ServerCallContext,
  InMemoryPushNotificationStore,
} from "@a2a-js/sdk/server";
import { ContentTypeNotSupportedError } from "@a2a-js/sdk/errors";
import {
  createBridge,
  listenLoopback,
  textPart,
  type BridgeOperation,
} from "../src/index.js";

const context = () => new ServerCallContext({ requestedVersion: "1.0" });
const request = (taskId = "") =>
  SendMessageRequest.fromJSON({
    message: {
      messageId: crypto.randomUUID(),
      role: Role.ROLE_USER,
      taskId,
      contextId: taskId ? "" : "shared",
      parts: [{ text: "hello", mediaType: "text/plain" }],
    },
  });

test("unsupported input is a protocol error before execution", async () => {
  let calls = 0;
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    runner: {
      async runTurn() {
        calls++;
        return { text: "done" };
      },
    },
  });
  const input = request();
  input.message!.parts.push({
    ...textPart(""),
    content: { $case: "raw", value: Buffer.from([1]) },
  });
  await expect(
    bridge.requestHandler.sendMessage(input, context()),
  ).rejects.toBeInstanceOf(ContentTypeNotSupportedError);
  expect(calls).toBe(0);
  await bridge.close();
});

for (const state of ["input_required", "auth_required"] as const) {
  test(`${state} is explicit, resumable, and preserves task history/artifacts`, async () => {
    let calls = 0;
    const bridge = createBridge({
      sharingDomain: "test",
      publicBaseUrl: "http://localhost",
      runner: {
        async runTurn() {
          return ++calls === 1
            ? { text: "partial", state, detail: "Trusted public prompt" }
            : { text: "done" };
        },
      },
    });
    const first = await bridge.requestHandler.sendMessage(request(), context());
    if (!("id" in first)) throw new Error("Expected task");
    expect(first.status?.state).toBe(
      state === "input_required"
        ? TaskState.TASK_STATE_INPUT_REQUIRED
        : TaskState.TASK_STATE_AUTH_REQUIRED,
    );
    const subscription = bridge.requestHandler.resubscribe(
      { id: first.id, tenant: "" },
      context(),
    );
    expect((await subscription.next()).value?.payload?.$case).toBe("task");
    await subscription.return();
    const next = await bridge.requestHandler.sendMessage(
      request(first.id),
      context(),
    );
    if (!("id" in next)) throw new Error("Expected task");
    expect(next.id).toBe(first.id);
    expect(next.contextId).toBe(first.contextId);
    expect(next.artifacts.length).toBe(2);
    expect(next.history.filter((m) => m.role === Role.ROLE_USER).length).toBe(
      2,
    );
    await bridge.close();
  });
}

test("trusted issuer/subject/tenant scopes tasks and conversation keys; direct calls fail closed", async () => {
  const callers = new WeakMap<
    ServerCallContext,
    { issuer: string; subject: string; tenant: string }
  >();
  const a = context(),
    b = context(),
    c = context();
  callers.set(a, { issuer: "one", subject: "same", tenant: "tenant" });
  callers.set(b, { issuer: "two", subject: "same", tenant: "tenant" });
  callers.set(c, { issuer: "one", subject: "same", tenant: "other" });
  const keys: string[] = [];
  const bridge = createBridge({
    sharingDomain: "binding",
    publicBaseUrl: "http://localhost",
    auth: {
      projectCaller: (ctx) => callers.get(ctx),
      authorize: ({ operation }) => operation !== "cancelTask",
    },
    runner: {
      async runTurn(req) {
        keys.push(req.a2aContextId);
        return { text: "done" };
      },
    },
  });
  const first = await bridge.requestHandler.sendMessage(request(), a);
  if (!("id" in first)) throw new Error("Expected task");
  await bridge.requestHandler.sendMessage(request(), b);
  await bridge.requestHandler.sendMessage(request(), c);
  expect(new Set(keys).size).toBe(3);
  await expect(
    bridge.requestHandler.getTask(GetTaskRequest.fromJSON({ id: first.id }), b),
  ).rejects.toThrow();
  expect(
    (await bridge.requestHandler.listTasks(ListTasksRequest.fromJSON({}), a))
      .tasks.length,
  ).toBe(1);
  await expect(
    bridge.requestHandler.cancelTask(
      { id: first.id, tenant: "", metadata: undefined },
      a,
    ),
  ).rejects.toThrow();
  const forged = request();
  forged.tenant = "other";
  await expect(bridge.requestHandler.sendMessage(forged, a)).rejects.toThrow();
  forged.tenant = "";
  forged.metadata = { issuer: "one", subject: "same", tenant: "tenant" };
  await expect(
    bridge.requestHandler.sendMessage(forged, context()),
  ).rejects.toThrow();
  await expect(bridge.requestHandler.getAgentCard()).rejects.toThrow();
  await bridge.close();
});

test("configured SDK push store receives the same trusted owner scope as tasks", async () => {
  const a = context(),
    b = context();
  const store = new InMemoryPushNotificationStore();
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    auth: {
      projectCaller: (c) => ({
        issuer: c === a ? "one" : "two",
        subject: "same",
        tenant: "t",
      }),
      authorize: () => true,
    },
    push: { store, sender: { async send() {} } },
    runner: {
      async runTurn() {
        return { text: "done" };
      },
    },
  });
  const first = await bridge.requestHandler.sendMessage(request(), a);
  if (!("id" in first)) throw new Error("Expected task");
  const config = TaskPushNotificationConfig.fromJSON({
    id: "config",
    taskId: first.id,
    url: "https://callback.example",
  });
  await bridge.requestHandler.createTaskPushNotificationConfig(config, a);
  const lookup = GetTaskPushNotificationConfigRequest.fromJSON({
    taskId: first.id,
    id: "config",
  });
  expect(
    (await bridge.requestHandler.getTaskPushNotificationConfig(lookup, a)).id,
  ).toBe("config");
  await expect(
    bridge.requestHandler.getTaskPushNotificationConfig(lookup, b),
  ).rejects.toThrow();
  await bridge.close();
});

test("every RPC is authorized, even disabled operations and direct streams", async () => {
  const seen: BridgeOperation[] = [];
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    auth: {
      projectCaller: () => ({
        issuer: "issuer",
        subject: "subject",
        tenant: "tenant",
      }),
      authorize: ({ operation }) => {
        seen.push(operation);
        return false;
      },
    },
    runner: {
      async runTurn() {
        throw new Error("must not run");
      },
    },
  });
  const h = bridge.requestHandler,
    c = context();
  const operations = [
    "getTask",
    "listTasks",
    "cancelTask",
    "createTaskPushNotificationConfig",
    "getTaskPushNotificationConfig",
    "listTaskPushNotificationConfigs",
    "deleteTaskPushNotificationConfig",
    "getAuthenticatedExtendedAgentCard",
    "sendMessage",
  ] as const;
  for (const operation of operations)
    await expect(h[operation]({} as never, c)).rejects.toThrow(
      "Operation forbidden",
    );
  await expect(h.sendMessageStream(request(), c).next()).rejects.toThrow(
    "Operation forbidden",
  );
  await expect(
    h.resubscribe({ id: "missing", tenant: "" }, c).next(),
  ).rejects.toThrow("Operation forbidden");
  await expect(h.getAgentCard(c)).rejects.toThrow("Operation forbidden");
  expect(seen).toEqual([
    ...operations,
    "sendMessageStream",
    "resubscribe",
    "discover",
  ]);
  await bridge.close();
});

test("simultaneous interrupted followups dispatch once; duplicate messages cannot create new tasks", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    runner: {
      async runTurn() {
        if (++calls === 1)
          return { text: "wait", state: "input_required" as const };
        await pending;
        return { text: "done" };
      },
    },
  });
  const initial = request();
  const first = await bridge.requestHandler.sendMessage(initial, context());
  if (!("id" in first)) throw new Error("Expected task");
  await expect(
    bridge.requestHandler.sendMessage(initial, context()),
  ).rejects.toThrow("Duplicate");
  const one = bridge.requestHandler.sendMessage(request(first.id), context());
  const two = bridge.requestHandler
    .sendMessageStream(request(first.id), context())
    .next();
  await expect(two).rejects.toThrow("already active");
  release();
  await one;
  expect(calls).toBe(2);
  const readback = await bridge.requestHandler.getTask(
    GetTaskRequest.fromJSON({ id: first.id }),
    context(),
  );
  expect(readback.history.filter((m) => m.role === Role.ROLE_USER).length).toBe(
    2,
  );
  await bridge.close();
});

for (const state of ["input_required", "auth_required"] as const) {
  test(`${state} streams finish without rewriting the wire state; subscriptions can resume and cancel`, async () => {
    const bridge = createBridge({
      sharingDomain: "test",
      publicBaseUrl: "http://localhost",
      runner: {
        async runTurn() {
          return { text: "wait", state };
        },
      },
    });
    const events = [];
    for await (const event of bridge.requestHandler.sendMessageStream(
      request(),
      context(),
    ))
      events.push(event);
    const first = events[0]!.payload;
    if (first?.$case !== "task") throw new Error("Expected task");
    const last = events.at(-1)?.payload;
    expect(last?.$case).toBe("statusUpdate");
    if (last?.$case !== "statusUpdate") throw new Error("Expected status");
    expect(last.value.status?.state).toBe(
      state === "input_required"
        ? TaskState.TASK_STATE_INPUT_REQUIRED
        : TaskState.TASK_STATE_AUTH_REQUIRED,
    );
    const sub = bridge.requestHandler.resubscribe(
      { id: first.value.id, tenant: "" },
      context(),
    );
    await sub.next();
    const update = sub.next();
    const canceled = await bridge.requestHandler.cancelTask(
      { id: first.value.id, tenant: "", metadata: undefined },
      context(),
    );
    expect(canceled.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect((await update).value?.payload?.$case).toBe("statusUpdate");
    expect((await sub.next()).done).toBe(true);
    await expect(
      bridge.requestHandler
        .resubscribe({ id: first.value.id, tenant: "" }, context())
        .next(),
    ).rejects.toThrow("terminal");
    await bridge.close();
  });
}

test("authenticated HTTP discovery permits discover-only callers and listener cannot bypass auth", async () => {
  const identities = new WeakMap<
    object,
    { issuer: string; subject: string; tenant: string }
  >();
  let calls = 0;
  const options = {
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    auth: {
      projectCaller: (c: ServerCallContext) =>
        c.user ? identities.get(c.user) : undefined,
      authorize: ({ operation }: { operation: BridgeOperation }) =>
        operation === "discover",
    },
    runner: {
      async runTurn() {
        calls++;
        return { text: "done" };
      },
    },
  };
  const uncomposed = createBridge(options);
  await expect(listenLoopback(uncomposed)).rejects.toThrow("transport");
  await uncomposed.close();
  const bridge = createBridge({
    ...options,
    transport: {
      userBuilder: async (req) => {
        const user = {
          isAuthenticated: req.headers.authorization === "Bearer fixture",
          userName: "fixture",
        };
        if (user.isAuthenticated)
          identities.set(user, {
            issuer: "fixture",
            subject: "reader",
            tenant: "tenant",
          });
        return user;
      },
    },
  });
  const listener = await listenLoopback(bridge);
  try {
    expect(
      (await fetch(`${listener.url}/.well-known/agent-card.json`)).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${listener.url}/.well-known/agent-card.json`, {
          headers: { Authorization: "Bearer fixture" },
        })
      ).status,
    ).toBe(200);
    const response = await fetch(listener.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "A2A-Version": "1.0",
        Authorization: "Bearer fixture",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "SendMessage",
        params: SendMessageRequest.toJSON(request()),
      }),
    });
    expect(JSON.stringify(await response.json())).toContain(
      "Operation forbidden",
    );
    expect(calls).toBe(0);
  } finally {
    await listener.close();
  }
});

test("list/history filters are official owner-scoped views, not stored truncations", async () => {
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    runner: {
      async runTurn() {
        return { text: "done" };
      },
    },
  });
  const first = await bridge.requestHandler.sendMessage(request(), context());
  if (!("id" in first)) throw new Error("Expected task");
  const second = request();
  second.message!.contextId = "other";
  await bridge.requestHandler.sendMessage(second, context());
  const page = await bridge.requestHandler.listTasks(
    ListTasksRequest.fromJSON({
      contextId: "shared",
      historyLength: 0,
      includeArtifacts: false,
    }),
    context(),
  );
  expect(page.tasks.length).toBe(1);
  expect(page.tasks[0]!.history).toEqual([]);
  expect(page.tasks[0]!.artifacts).toEqual([]);
  const full = await bridge.requestHandler.getTask(
    GetTaskRequest.fromJSON({ id: first.id }),
    context(),
  );
  expect(full.history.length).toBeGreaterThan(0);
  expect(full.artifacts.length).toBe(1);
  await expect(
    bridge.requestHandler.getTask(
      GetTaskRequest.fromJSON({ id: first.id, historyLength: -1 }),
      context(),
    ),
  ).rejects.toThrow("historyLength");
  await bridge.close();
});

test("owner cancellation remains pending until execution settles and cannot be stolen", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let aborted = false;
  const a = context(),
    b = context();
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    auth: {
      projectCaller: (c) => ({
        issuer: "issuer",
        subject: c === a ? "a" : "b",
        tenant: "t",
      }),
      authorize: () => true,
    },
    runner: {
      async runTurn(req) {
        req.signal.addEventListener("abort", () => {
          aborted = true;
        });
        await pending;
        return { text: "done" };
      },
    },
  });
  const input = request();
  input.configuration = {
    acceptedOutputModes: [],
    returnImmediately: true,
    historyLength: undefined,
    taskPushNotificationConfig: undefined,
  };
  const first = await bridge.requestHandler.sendMessage(input, a);
  if (!("id" in first)) throw new Error("Expected task");
  await expect(
    bridge.requestHandler.cancelTask(
      { id: first.id, tenant: "", metadata: undefined },
      b,
    ),
  ).rejects.toThrow();
  expect(aborted).toBe(false);
  let settled = false;
  const cancel = bridge.requestHandler
    .cancelTask({ id: first.id, tenant: "", metadata: undefined }, a)
    .then((task) => {
      settled = true;
      return task;
    });
  await new Promise((resolve) => setTimeout(resolve, 1));
  expect(aborted).toBe(true);
  expect(settled).toBe(false);
  await expect(
    bridge.requestHandler.sendMessage(request(first.id), a),
  ).rejects.toThrow("already active");
  release();
  expect((await cancel).status?.state).toBe(TaskState.TASK_STATE_CANCELED);
  await bridge.close();
});

test("disconnected streaming callers do not abandon task persistence", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    runner: {
      async runTurn() {
        await pending;
        return { text: "done" };
      },
    },
  });
  const stream = bridge.requestHandler.sendMessageStream(request(), context());
  const first = (await stream.next()).value?.payload;
  if (first?.$case !== "task") throw new Error("Expected task");
  await stream.return();
  release();
  let task;
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    task = await bridge.requestHandler.getTask(
      GetTaskRequest.fromJSON({ id: first.value.id }),
      context(),
    );
    if (task.status?.state === TaskState.TASK_STATE_COMPLETED) break;
  }
  expect(task?.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
  await bridge.close();
});

test("model metadata cannot reset trusted delegation; private errors stay out of protocol output", async () => {
  const errors: unknown[] = [];
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    auth: {
      projectCaller: () => ({
        issuer: "trusted",
        subject: "delegate",
        tenant: "t",
        delegation: { hop: 2, allowDelegation: false },
      }),
      authorize: () => true,
    },
    onError: (event) => {
      errors.push(event.error);
      throw new Error("callback failure");
    },
    runner: {
      async runTurn(req) {
        expect(req.caller?.delegation).toEqual({
          hop: 2,
          allowDelegation: false,
        });
        expect(Object.isFrozen(req.caller?.delegation)).toBe(true);
        throw new Error("private credential");
      },
    },
  });
  const input = request();
  input.message!.metadata = { hop: 0, tenant: "other", caller: "admin" };
  const result = await bridge.requestHandler.sendMessage(input, context());
  expect(JSON.stringify(result)).not.toContain("private credential");
  expect(errors.length).toBe(1);
  await bridge.close();
});
