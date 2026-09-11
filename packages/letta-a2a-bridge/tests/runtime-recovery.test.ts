import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import type {
  LettaAgentClient,
  SDKResultMessage,
} from "@letta-ai/letta-agent-sdk";
import {
  AgentSdkTurnRunner,
  LettaTurnCancelledError,
  createBridge,
  createToolPolicy,
} from "../src/index.js";

function fixture(
  result: SDKResultMessage,
  options: { cancel?: boolean; disposalFails?: boolean } = {},
) {
  const cancellation = new AbortController();
  let opened = 0;
  const session = {
    async ready() {
      return { conversationId: "conversation" };
    },
    async send() {},
    async abort() {},
    async *stream() {
      if (options.cancel) cancellation.abort();
      yield result;
    },
    async [Symbol.asyncDispose]() {
      if (options.disposalFails) throw new Error("Session disposal failed");
    },
  };
  const open = () => {
    opened++;
    return session;
  };
  const client = {
    createSession: open,
    resumeSession: open,
  } as unknown as Pick<LettaAgentClient, "createSession" | "resumeSession">;
  const runner = new AgentSdkTurnRunner(client, "agent", {
    sharingDomain: "test",
    sessionOptions: createToolPolicy(),
  });
  const run = (signal = new AbortController().signal) =>
    runner.runTurn({
      a2aContextId: "context",
      messageId: crypto.randomUUID(),
      text: "hello",
      signal,
      onAssistantText() {},
    });
  return { runner, run, cancellation, opened: () => opened };
}

const failed: SDKResultMessage = {
  type: "result",
  conversationId: "conversation",
  success: false,
  durationMs: 1,
  stopReason: "stream_closed",
  error: "stream_closed",
  errorCode: "stream_closed",
  errorDetail: "Connection closed unexpectedly",
};

describe("SDK failure and cancellation evidence", () => {
  for (const cancel of [false, true]) {
    test(`synthetic failed result quarantines context${cancel ? " even after cancellation" : ""}`, async () => {
      const f = fixture(failed, { cancel });
      const error = await f.run(f.cancellation.signal).catch((error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(LettaTurnCancelledError);
      expect(f.runner.unresolvedContexts).toEqual(["context"]);
      await assert.rejects(f.run(), /reconciliation/);
      expect(f.opened()).toBe(1);
      const bridge = createBridge({
        sharingDomain: "test",
        publicBaseUrl: "http://127.0.0.1:9999",
        runner: f.runner,
      });
      expect(await bridge.close()).toMatchObject({
        complete: false,
        unresolvedContextIds: ["context"],
      });
    });
  }

  test("SDK interrupted result does not confirm backend settlement", async () => {
    const f = fixture({ ...failed, stopReason: "interrupted" });
    await assert.rejects(f.run(), /reconciliation/);
    expect(f.runner.unresolvedContexts).toEqual(["context"]);
  });

  test("a pending approval is not treated as completed execution", async () => {
    const f = fixture({
      ...failed,
      success: true,
      stopReason: "requires_approval",
    });
    await assert.rejects(f.run(), /reconciliation/);
    expect(f.runner.unresolvedContexts).toEqual(["context"]);
  });

  test("failed disposal is not reported as a clean settled context", async () => {
    const f = fixture(
      {
        type: "result",
        conversationId: "conversation",
        success: true,
        durationMs: 1,
        result: "done",
      },
      { disposalFails: true },
    );
    await assert.rejects(f.run(), /disposal failed/);
    expect(f.runner.unresolvedContexts).toEqual(["context"]);
    await assert.rejects(f.run(), /reconciliation/);
    expect(f.opened()).toBe(1);
  });
});
