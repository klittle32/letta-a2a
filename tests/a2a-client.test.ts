import { describe, expect, test } from "bun:test";

import {
  A2A_EXTERNAL_TOOL,
  A2AInvocationCancelledError,
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

  test("aborts polling and best-effort cancels the accepted remote task", async () => {
    const controller = new AbortController();
    const methods: string[] = [];
    const requestSignals: Array<boolean | undefined> = [];
    let acceptRemoteTask!: () => void;
    const remoteTaskAccepted = new Promise<void>((resolve) => {
      acceptRemoteTask = resolve;
    });

    const invocation = invokeA2A(
      { target: "reference-agent", message: "slow 30" },
      {
        gatewayUrl: "http://litellm-reference:4000",
        gatewayKey: "test-key",
        pollIntervalMs: 60_000,
        cancelTimeoutMs: 1_000,
      },
      async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        methods.push(request.method);
        requestSignals.push(init?.signal?.aborted);
        if (request.method === "SendMessage") {
          acceptRemoteTask();
          return jsonResponse({
            id: request.id,
            result: {
              task: {
                id: "remote-task-1",
                contextId: "remote-context-1",
                status: { state: "TASK_STATE_WORKING" },
              },
            },
          });
        }
        if (request.method === "CancelTask") {
          return jsonResponse({
            id: request.id,
            result: {
              task: {
                id: "remote-task-1",
                contextId: "remote-context-1",
                status: { state: "TASK_STATE_CANCELED" },
              },
            },
          });
        }
        throw new Error(`unexpected method ${request.method}`);
      },
      controller.signal,
    );

    await remoteTaskAccepted;
    controller.abort();

    await expect(invocation).rejects.toBeInstanceOf(
      A2AInvocationCancelledError,
    );
    expect(methods).toEqual(["SendMessage", "CancelTask"]);
    expect(requestSignals).toEqual([false, false]);
  });

  test("cancels an accepted remote task when the polling budget expires", async () => {
    const methods: string[] = [];

    const invocation = invokeA2A(
      { target: "reference-agent", message: "slow 30" },
      {
        gatewayUrl: "http://litellm-reference:4000",
        gatewayKey: "test-key",
        pollIntervalMs: 60_000,
        timeoutMs: 10,
        cancelTimeoutMs: 1_000,
      },
      async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        methods.push(request.method);
        if (request.method === "SendMessage") {
          return jsonResponse({
            id: request.id,
            result: {
              task: {
                id: "remote-timeout-task",
                contextId: "remote-timeout-context",
                status: { state: "TASK_STATE_WORKING" },
              },
            },
          });
        }
        if (request.method === "CancelTask") {
          return jsonResponse({
            id: request.id,
            result: {
              task: {
                id: "remote-timeout-task",
                contextId: "remote-timeout-context",
                status: { state: "TASK_STATE_CANCELED" },
              },
            },
          });
        }
        throw new Error(`unexpected method ${request.method}`);
      },
    );

    await expect(invocation).rejects.toThrow("A2A invocation timed out after");
    expect(methods).toEqual(["SendMessage", "CancelTask"]);
  });
});

function jsonResponse(payload: object): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", ...payload }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
