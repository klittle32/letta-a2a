import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { SendMessageRequest } from "@a2a-js/sdk";
import { ServerCallContext } from "@a2a-js/sdk/server";
import { createBridge } from "../src/index.js";

describe("same-task execution ownership", () => {
  for (const streaming of [false, true]) {
    test(`rejects active same-task ${streaming ? "streaming" : "ordinary"} follow-up without losing cancellation`, async () => {
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let calls = 0;
      let aborted = false;
      const bridge = createBridge({
        sharingDomain: "test",
        publicBaseUrl: "http://127.0.0.1:9999",
        shutdownTimeoutMs: 1,
        runner: {
          async runTurn(request) {
            calls++;
            request.signal.addEventListener("abort", () => {
              aborted = true;
            });
            await pending;
            return { text: "done" };
          },
        },
      });
      const context = new ServerCallContext({ requestedVersion: "1.0" });
      const request = (taskId?: string) =>
        SendMessageRequest.fromJSON({
          message: {
            messageId: crypto.randomUUID(),
            taskId,
            role: "ROLE_USER",
            parts: [{ text: "hello" }],
          },
          configuration: { returnImmediately: true },
        });
      try {
        const first = await bridge.requestHandler.sendMessage(
          request(),
          context,
        );
        assert("id" in first);
        const followUp = request(first.id);
        await assert.rejects(async () => {
          if (streaming) {
            for await (const _event of bridge.requestHandler.sendMessageStream(
              followUp,
              context,
            ))
              break;
          } else {
            await bridge.requestHandler.sendMessage(followUp, context);
          }
        }, /Task execution is already active/);
        expect(calls).toBe(1);
        const closed = await bridge.close();
        expect(aborted).toBe(true);
        expect(closed.complete).toBe(false);
        expect(closed.pendingTaskIds).toEqual([first.id]);
      } finally {
        finish();
        await bridge.close();
      }
    });
  }
});
