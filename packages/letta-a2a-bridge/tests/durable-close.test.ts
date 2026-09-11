import { test, expect } from "bun:test";
import { SendMessageRequest } from "@a2a-js/sdk";
import { ServerCallContext, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { createBridge } from "../src/bridge.js";

test("close holds durable ownership while a pre-dispatch request is still awaiting auth", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const releases: boolean[] = [];
  let calls = 0;
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    shutdownTimeoutMs: 10,
    auth: {
      async projectCaller() {
        entered();
        await gate;
        return { issuer: "issuer", subject: "subject", tenant: "" };
      },
      authorize: () => true,
    },
    runner: {
      async runTurn() {
        calls++;
        return { text: "must not execute" };
      },
    },
    durability: {
      taskStore: new InMemoryTaskStore(),
      attach: () => async (complete: boolean) => {
        releases.push(complete);
      },
      unresolvedContexts: [],
      assertAvailable() {},
      async reserveMessage() {},
    } as any,
  });
  const pending = bridge.requestHandler
    .sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: "m",
          role: "ROLE_USER",
          parts: [{ text: "work" }],
        },
      }),
      new ServerCallContext(),
    )
    .catch((error) => error);
  await ready;
  const closed = await bridge.close();
  release();
  await pending;
  expect(closed.complete).toBe(false);
  expect(releases).not.toContain(true);
  expect(calls).toBe(0);
});

test("close never uses an empty executor snapshot before a reserved async request dispatches", async () => {
  const store = new InMemoryTaskStore();
  const releases: boolean[] = [];
  const lateSaves: string[] = [];
  let released = false;
  let finish!: () => void;
  const publication = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let closeStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    closeStarted = resolve;
  });
  let closing: ReturnType<ReturnType<typeof createBridge>["close"]> | undefined;
  const durability = {
    taskStore: {
      load: store.load.bind(store),
      list: store.list.bind(store),
      async save(task: any, c: any) {
        if (released) lateSaves.push(task.id);
        await store.save(task, c);
      },
    },
    attach: () => async (complete: boolean) => {
      releases.push(complete);
      released = complete;
    },
    unresolvedContexts: [],
    assertAvailable() {},
    async reserveMessage() {
      queueMicrotask(() =>
        queueMicrotask(() => {
          closing = bridge.close();
          closeStarted();
        }),
      );
    },
    async accept(r: any, task: any) {
      await store.save(task, r.context);
    },
    async dispatched() {},
    async publication() {
      await publication;
    },
    async waitPublished() {},
  } as any;
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "http://localhost",
    shutdownTimeoutMs: 10,
    durability,
    runner: {
      async runTurn() {
        return { text: "not expected" };
      },
    },
  });
  const response = bridge.requestHandler
    .sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: "race",
          role: "ROLE_USER",
          parts: [{ text: "work" }],
        },
        configuration: { returnImmediately: true },
      }),
      new ServerCallContext(),
    )
    .catch((e) => e);
  await started;
  const closed = await closing!;
  const result = await response;
  if (result && "id" in result)
    expect(closed.complete && bridge.executor.isActive(result.id)).toBe(false);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(lateSaves).toEqual([]);
});
