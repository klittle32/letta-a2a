import { describe, expect, test } from "bun:test";

import {
  A2A_EXTERNAL_TOOL,
  invokeA2A,
} from "../services/bridge/src/a2a-client.js";

describe("A2A client transport", () => {
  test("publishes a narrow controller-owned external tool", () => {
    expect(A2A_EXTERNAL_TOOL.name).toBe("a2a_invoke");
    expect(A2A_EXTERNAL_TOOL.parameters).toMatchObject({
      type: "object",
      required: ["target", "message"],
      additionalProperties: false,
    });
  });

  test("sends a version 1.0 SendMessage request through LiteLLM", async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];

    const result = await invokeA2A(
      {
        target: "agent-b",
        message: "hello",
        context_id: "ctx-existing",
        hop: 1,
      },
      {
        gatewayUrl: "http://litellm:4000",
        gatewayKey: "test-key",
        pollIntervalMs: 0,
      },
      async (input, init) => {
        captured.push({ url: String(input), init });
        const request = JSON.parse(String(init?.body));
        if (request.method === "GetTask") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result: {
                task: {
                  id: "task-1",
                  contextId: "ctx-existing",
                  status: { state: "TASK_STATE_COMPLETED" },
                  artifacts: [{ parts: [{ text: "hi from B" }] }],
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              task: {
                id: "task-1",
                contextId: "ctx-existing",
                status: { state: "TASK_STATE_SUBMITTED" },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    expect(captured[0]?.url).toBe("http://litellm:4000/a2a/agent-b");
    expect(captured[0]?.init?.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
      "A2A-Version": "1.0",
    });

    const body = JSON.parse(String(captured[0]?.init?.body));
    expect(body.method).toBe("SendMessage");
    expect(body.params.configuration.returnImmediately).toBe(true);
    expect(body.params.message.contextId).toBe("ctx-existing");
    expect(body.params.metadata).toEqual({ lettaA2aLab: { hop: 1 } });
    const pollBody = JSON.parse(String(captured[1]?.init?.body));
    expect(pollBody).toMatchObject({ method: "GetTask", params: { id: "task-1" } });
    expect(result).toEqual({
      contextId: "ctx-existing",
      taskId: "task-1",
      text: "hi from B",
    });
  });
});
