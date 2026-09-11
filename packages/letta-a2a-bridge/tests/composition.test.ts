import { expect, test } from "bun:test";
import { ServerCallContext } from "@a2a-js/sdk/server";
import { SendMessageRequest } from "@a2a-js/sdk";
import { TaskNotFoundError } from "@a2a-js/sdk/errors";
import {
  createBridge,
  createPushNotifications,
  LettaTurnCancelledError,
} from "../src/index.js";

test("authorization receives the exact request context, not a shared principal scope cache", async () => {
  const restricted = new ServerCallContext({ requestedVersion: "1.0" });
  const broad = new ServerCallContext({ requestedVersion: "1.0" });
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    runner: {
      async runTurn() {
        return { text: "done" };
      },
    },
    auth: {
      projectCaller: () => ({ issuer: "issuer", subject: "same", tenant: "" }),
      authorize: ({ context }) => context === broad,
    },
  });
  try {
    await expect(
      bridge.requestHandler.getAgentCard(broad),
    ).resolves.toBeDefined();
    await expect(
      bridge.requestHandler.getAgentCard(restricted),
    ).rejects.toThrow("forbidden");
  } finally {
    await bridge.close();
  }
});

test("bridge closes owned push delivery and preserves incomplete cleanup", async () => {
  const push = createPushNotifications({
    callbacks: [{ url: "http://localhost/callback", bearerToken: "fixture" }],
  });
  let calls = 0;
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    runner: {
      async runTurn() {
        return { text: "done" };
      },
    },
    push: {
      ...push,
      async close() {
        calls++;
        return { complete: false, pending: 1 };
      },
    },
  });
  const closing = bridge.close();
  expect(bridge.close()).toBe(closing);
  const result = await closing;
  expect(calls).toBe(1);
  expect(result.complete).toBe(false);
  expect(result.push).toEqual({ complete: false, pending: 1 });
  await push.close();
});

test("custom push shutdown cannot hang bridge shutdown", async () => {
  const push = createPushNotifications({
    callbacks: [{ url: "http://localhost/callback", bearerToken: "fixture" }],
  });
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    shutdownTimeoutMs: 10,
    runner: {
      async runTurn() {
        return { text: "done" };
      },
    },
    push: { ...push, close: () => new Promise(() => {}) },
  });
  const result = await bridge.close();
  expect(result.complete).toBe(false);
  expect(result.push?.complete).toBe(false);
  await push.close();
});

test("a foreign caller cannot reserve or inspect another owner's active task", async () => {
  const a = new ServerCallContext({ requestedVersion: "1.0" });
  const b = new ServerCallContext({ requestedVersion: "1.0" });
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    auth: {
      projectCaller: (context) => ({
        issuer: "issuer",
        subject: context === a ? "a" : "b",
        tenant: "",
      }),
      authorize: () => true,
    },
    runner: {
      runTurn(request) {
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(new LettaTurnCancelledError()),
            { once: true },
          );
          started();
        });
      },
    },
  });
  try {
    const result = await bridge.requestHandler.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: "first",
          role: "ROLE_USER",
          parts: [{ text: "run" }],
        },
        configuration: { returnImmediately: true },
      }),
      a,
    );
    if (!("id" in result)) throw new Error("Expected task");
    await active;
    await expect(
      bridge.requestHandler.sendMessage(
        SendMessageRequest.fromJSON({
          message: {
            messageId: "foreign",
            taskId: result.id,
            role: "ROLE_USER",
            parts: [{ text: "continue" }],
          },
        }),
        b,
      ),
    ).rejects.toBeInstanceOf(TaskNotFoundError);
    const outcomes = await Promise.allSettled([
      bridge.requestHandler.cancelTask(
        { id: result.id, tenant: "", metadata: undefined },
        b,
      ),
      bridge.requestHandler.cancelTask(
        { id: result.id, tenant: "", metadata: undefined },
        a,
      ),
    ]);
    expect(outcomes[0]?.status).toBe("rejected");
    expect(outcomes[1]?.status).toBe("fulfilled");
  } finally {
    await bridge.close();
  }
});
