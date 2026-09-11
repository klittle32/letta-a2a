import { describe, expect, test } from "bun:test";
import type {
  CreateSessionOptions,
  LettaAgentClient,
} from "@letta-ai/letta-agent-sdk";
import { AgentSdkTurnRunner, type SessionScope } from "../src/index.js";

describe("session-owned tool resources", () => {
  test("binds ready conversation identity and disposes per-session tools after the SDK", async () => {
    const events: string[] = [];
    const scopes: SessionScope[] = [];
    const open = (_id: string, options: CreateSessionOptions) => ({
      async ready() {
        return { conversationId: "conversation" };
      },
      async send() {
        expect(options.cwd).toBe("/workspace");
        expect(scopes.at(-1)?.conversationId).toBe("conversation");
        events.push("sent");
      },
      async abort() {},
      async *stream() {
        yield {
          type: "result",
          success: true,
          result: "done",
          conversationId: "conversation",
          durationMs: 1,
        };
      },
      async [Symbol.asyncDispose]() {
        events.push("sdk disposed");
      },
    });
    const client = {
      createSession: open,
      resumeSession: open,
    } as unknown as Pick<LettaAgentClient, "createSession" | "resumeSession">;
    const runner = new AgentSdkTurnRunner(client, "agent", {
      sharingDomain: "local",
      sessionOptions(scope) {
        scopes.push(scope);
        expect(scope.agentId).toBe("agent");
        return {
          options: { cwd: "/workspace" },
          async close() {
            events.push("tools disposed");
          },
        };
      },
    });
    for (let turn = 0; turn < 2; turn++) {
      const signal = new AbortController().signal;
      await runner.runTurn({
        a2aContextId: "context",
        messageId: `message-${turn}`,
        text: "hi",
        signal,
        onAssistantText() {},
      });
      expect(scopes[turn]?.signal).toBe(signal);
    }
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).not.toBe(scopes[1]);
    expect(events).toEqual([
      "sent",
      "sdk disposed",
      "tools disposed",
      "sent",
      "sdk disposed",
      "tools disposed",
    ]);
  });

  test("failed tool cleanup quarantines an otherwise successful turn", async () => {
    const client = {
      createSession() {
        return {
          async ready() {
            return { conversationId: "conversation" };
          },
          async send() {},
          async abort() {},
          async *stream() {
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
      },
      resumeSession() {
        throw new Error("Must not resume unresolved work");
      },
    } as unknown as Pick<LettaAgentClient, "createSession" | "resumeSession">;
    const runner = new AgentSdkTurnRunner(client, "agent", {
      sharingDomain: "local",
      sessionOptions: () => ({
        options: {},
        async close() {
          throw new Error("Tool cleanup incomplete");
        },
      }),
    });
    const run = () =>
      runner.runTurn({
        a2aContextId: "context",
        messageId: "message",
        text: "hi",
        signal: new AbortController().signal,
        onAssistantText() {},
      });
    await expect(run()).rejects.toThrow("Tool cleanup incomplete");
    expect(runner.unresolvedContexts).toEqual(["context"]);
    await expect(run()).rejects.toThrow("reconciliation");
  });
});
