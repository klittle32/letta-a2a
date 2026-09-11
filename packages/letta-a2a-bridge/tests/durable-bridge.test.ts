import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SendMessageRequest, TaskState } from "@a2a-js/sdk";
import { ServerCallContext } from "@a2a-js/sdk/server";
import { createBridge } from "../src/bridge.js";
import { DurableBinding } from "../src/durable-binding.js";

const context = () => new ServerCallContext({ requestedVersion: "1.0" });
const message = (id: string, taskId?: string, contextId?: string) =>
  SendMessageRequest.fromJSON({
    message: {
      messageId: id,
      taskId,
      contextId,
      role: "ROLE_USER",
      parts: [{ text: "work" }],
    },
  });
test("durable bridge repairs interrupted ownership and rejects duplicates after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "durable-bridge-"));
  const options = { directory, bindingId: "binding" };
  let state = await DurableBinding.open(options);
  let calls = 0;
  const runner = {
    async runTurn() {
      calls++;
      return { text: "answer", state: "input_required" as const };
    },
  };
  let bridge = createBridge({
    sharingDomain: "binding",
    publicBaseUrl: "http://localhost",
    runner,
    durability: state,
  });
  try {
    const first = await bridge.requestHandler.sendMessage(
      message("one"),
      context(),
    );
    if (!("id" in first)) throw new Error("Expected task");
    const task = first;
    expect(task.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    expect((await bridge.close()).complete).toBe(true);
    state = await DurableBinding.open(options);
    bridge = createBridge({
      sharingDomain: "binding",
      publicBaseUrl: "http://localhost",
      runner,
      durability: state,
    });
    await expect(
      bridge.requestHandler.sendMessage(message("one"), context()),
    ).rejects.toThrow("Duplicate");
    const next = await bridge.requestHandler.sendMessage(
      message("two", task.id),
      context(),
    );
    expect("id" in next).toBe(true);
    expect(calls).toBe(2);
  } finally {
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("SDK convenience composition persists and resumes exactly the saved conversation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "durable-sdk-"));
  const options = { directory, bindingId: "sdk-binding" };
  let creates = 0,
    resumes = 0,
    sends = 0;
  const session = () => ({
    async ready() {
      return { conversationId: "conversation" };
    },
    async send() {
      sends++;
    },
    async abort() {},
    async *stream() {
      yield { type: "assistant", content: "answer" };
      yield {
        type: "result",
        success: true,
        result: "answer",
        stopReason: "end_turn",
      };
    },
    async [Symbol.asyncDispose]() {},
  });
  const client = {
    createSession() {
      creates++;
      return session();
    },
    resumeSession(id: string) {
      expect(id).toBe("conversation");
      resumes++;
      return session();
    },
  } as any;
  let state = await DurableBinding.open(options);
  let bridge = createBridge({
    sharingDomain: "binding",
    publicBaseUrl: "http://localhost",
    client,
    agentId: "agent",
    sessionOptions: {},
    durability: state,
  });
  try {
    const first = await bridge.requestHandler.sendMessage(
      message("one"),
      context(),
    );
    if (!("id" in first)) throw new Error("Expected task");
    const id = first.contextId;
    await bridge.close();
    state = await DurableBinding.open(options);
    bridge = createBridge({
      sharingDomain: "binding",
      publicBaseUrl: "http://localhost",
      client,
      agentId: "agent",
      sessionOptions: {},
      durability: state,
    });
    await bridge.requestHandler.sendMessage(
      message("two", undefined, id),
      context(),
    );
    expect([creates, resumes, sends]).toEqual([1, 1, 2]);
  } finally {
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
});
