import { expect, test } from "bun:test";
import type { LettaAgentClient } from "@letta-ai/letta-agent-sdk";
import { AgentSdkTurnRunner } from "../src/letta-agent.js";
import { createAgentToolGuard } from "../src/tool-policy.js";

test("queued turns recheck existing-agent tools inside the execution lock", async () => {
  let tools: unknown = [];
  let opened = 0;
  let release!: () => void;
  const finish = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const active = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const open = () => {
    opened++;
    return {
      async ready() {
        return { conversationId: "conversation" };
      },
      async send() {
        entered();
      },
      async abort() {},
      async *stream() {
        await finish;
        yield {
          type: "result",
          success: true,
          result: "done",
          conversationId: "conversation",
          durationMs: 1,
        };
      },
      async [Symbol.asyncDispose]() {},
    };
  };
  const client = {
    createSession: open,
    resumeSession: open,
  } as unknown as Pick<LettaAgentClient, "createSession" | "resumeSession">;
  const guard = createAgentToolGuard(
    {
      agents: {
        async retrieve(id: string) {
          return { id, tools };
        },
      },
    },
    "agent",
  );
  const runner = new AgentSdkTurnRunner(client, "agent", {
    sharingDomain: "test",
    sessionOptions: {},
    beforeTurn: (request) => guard(request.signal),
  });
  const request = (id: string) => ({
    a2aContextId: "context",
    messageId: id,
    text: "hello",
    signal: new AbortController().signal,
    onAssistantText() {},
  });
  const first = runner.runTurn(request("first"));
  await active;
  const second = runner.runTurn(request("second"));
  tools = [{ id: "unexpected", name: "write" }];
  release();
  await first;
  await expect(second).rejects.toThrow("unapproved");
  expect(opened).toBe(1);
});
