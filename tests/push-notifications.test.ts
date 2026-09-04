import { describe, expect, test } from "bun:test";
import { TaskState, type TaskPushNotificationConfig } from "@a2a-js/sdk";
import { ServerCallContext } from "@a2a-js/sdk/server";

import {
  LabPushNotificationSender,
  ValidatingPushNotificationStore,
} from "../services/bridge/src/push-notifications.js";

const callbackUrl = "http://webhook-receiver:8100/callbacks/a2a";
const callbackToken = "callback-secret";
const context = new ServerCallContext({ requestedVersion: "1.0" });

describe("push notification registration policy", () => {
  test("stores only the exact Bearer-authenticated callback and redacts reads", async () => {
    const store = new ValidatingPushNotificationStore(
      callbackUrl,
      callbackToken,
    );
    const config = pushConfig({ taskId: "" });

    await store.save("task-1", context, config);

    expect(config.taskId).toBe("task-1");
    const visible = await store.load("task-1", context);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.authentication?.scheme).toBe("Bearer");
    expect(visible[0]?.authentication?.credentials).toBe("");
    const dispatch = await store.loadWithMetadata("task-1", context);
    expect(dispatch[0]?.config.authentication?.credentials).toBe(callbackToken);
  });

  test("rejects callback confusion and SSRF targets before storage", async () => {
    const store = new ValidatingPushNotificationStore(
      callbackUrl,
      callbackToken,
    );
    const rejected = [
      pushConfig({ url: "http://169.254.169.254/latest/meta-data" }),
      pushConfig({ url: `${callbackUrl}?redirect=internal` }),
      pushConfig({ url: `${callbackUrl}#fragment` }),
      pushConfig({ authentication: { scheme: "Basic", credentials: callbackToken } }),
      pushConfig({ authentication: { scheme: "bearer", credentials: callbackToken } }),
      pushConfig({ authentication: { scheme: "Bearer", credentials: "wrong" } }),
      pushConfig({ token: callbackToken }),
      pushConfig({ taskId: "other-task" }),
    ];

    for (const config of rejected) {
      await expect(store.save("task-1", context, config)).rejects.toThrow();
    }
    await expect(
      store.save(
        "task-1",
        new ServerCallContext({ requestedVersion: "0.3" }),
        pushConfig(),
      ),
    ).rejects.toThrow("A2A 1.0");
    expect(await store.load("task-1", context)).toEqual([]);
  });
});

describe("push notification delivery", () => {
  test("sends canonical authenticated events in per-task order without redirects", async () => {
    const store = new ValidatingPushNotificationStore(
      callbackUrl,
      callbackToken,
    );
    await store.save("task-1", context, pushConfig());
    const requests: Array<{ input: string; init: RequestInit; body: any }> = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sender = new LabPushNotificationSender(store, {
      fetchImpl: async (input, init) => {
        requests.push({
          input: String(input),
          init: init ?? {},
          body: JSON.parse(String(init?.body)),
        });
        if (requests.length === 1) await firstGate;
        return new Response(null, { status: 204 });
      },
      timeoutMs: 1_000,
    });

    const working = sender.send(statusResponse(TaskState.TASK_STATE_WORKING), context);
    const completed = sender.send(
      statusResponse(TaskState.TASK_STATE_COMPLETED),
      context,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toHaveLength(1);
    releaseFirst();
    await Promise.all([working, completed]);

    expect(requests.map((request) => request.input)).toEqual([
      callbackUrl,
      callbackUrl,
    ]);
    expect(
      requests.map((request) => request.body.statusUpdate.status.state),
    ).toEqual(["TASK_STATE_WORKING", "TASK_STATE_COMPLETED"]);
    for (const request of requests) {
      expect(request.init.redirect).toBe("error");
      expect(request.init.headers).toMatchObject({
        Authorization: `Bearer ${callbackToken}`,
        "Content-Type": "application/a2a+json",
      });
    }
  });

  test("contains delivery failure without changing task execution", async () => {
    const store = new ValidatingPushNotificationStore(
      callbackUrl,
      callbackToken,
    );
    await store.save("task-1", context, pushConfig());
    const sender = new LabPushNotificationSender(store, {
      fetchImpl: async () => new Response(null, { status: 503 }),
      timeoutMs: 1_000,
    });

    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      await expect(
        sender.send(statusResponse(TaskState.TASK_STATE_COMPLETED), context),
      ).resolves.toBeUndefined();
    } finally {
      console.warn = originalWarn;
    }
  });
});

function pushConfig(
  overrides: Partial<TaskPushNotificationConfig> = {},
): TaskPushNotificationConfig {
  return {
    tenant: "",
    id: "callback-1",
    taskId: "task-1",
    url: callbackUrl,
    token: "",
    authentication: { scheme: "Bearer", credentials: callbackToken },
    ...overrides,
  };
}

function statusResponse(state: TaskState) {
  return {
    payload: {
      $case: "statusUpdate" as const,
      value: {
        taskId: "task-1",
        contextId: "context-1",
        status: {
          state,
          timestamp: new Date().toISOString(),
          message: undefined,
        },
        metadata: {},
      },
    },
  };
}
