import { describe, expect, test } from "bun:test";
import { TaskState } from "@a2a-js/sdk";
import {
  A2A_EXTERNAL_TOOL,
  A2AInvocationCancelledError,
  invokeA2A,
} from "../services/bridge/src/a2a-client.js";

const endpoint = "http://gateway:4000/a2a/agent-b";
const card = (url = endpoint) => ({
  name: "fixture",
  description: "Outbound fixture",
  version: "1",
  supportedInterfaces: [
    { url, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
  ],
  capabilities: {},
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [],
});
const task = (state: string) => ({
  id: "task-1",
  contextId: "ctx-existing",
  status: {
    state,
    message: {
      messageId: "status-1",
      role: "ROLE_AGENT",
      parts: [{ text: "remote detail" }],
    },
  },
  artifacts: [{ artifactId: "output", parts: [{ text: "hi from B" }] }],
});
const config = {
  gatewayUrl: "http://gateway:4000",
  tokenProvider: { getAccessToken: async () => "oauth-access-token" },
  pollIntervalMs: 0,
};
const args = {
  target: "agent-b",
  message: "hello",
  context_id: "ctx-existing",
  hop: 2,
};
function fixture(states: string[], advertised = endpoint, onSend?: () => void) {
  const calls: Array<{
    url: string;
    headers: Headers;
    body?: any;
    aborted?: boolean;
  }> = [];
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body,
      aborted: init?.signal?.aborted,
    });
    if (!body) return Response.json(card(advertised));
    if (body.method === "SendMessage") onSend?.();
    const snapshot = task(
      body.method === "CancelTask"
        ? "TASK_STATE_CANCELED"
        : (states.shift() ?? "TASK_STATE_WORKING"),
    );
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: body.method === "SendMessage" ? { task: snapshot } : snapshot,
    });
  };
  return { calls, fetchImpl };
}

describe("public outbound client convergence", () => {
  test("keeps hop outside the model schema", () => {
    expect(A2A_EXTERNAL_TOOL.parameters.additionalProperties).toBe(false);
    expect(A2A_EXTERNAL_TOOL.parameters.properties).not.toHaveProperty("hop");
  });
  test("discovers a real card, scopes OAuth and sends asynchronously with both host hop representations", async () => {
    const f = fixture(["TASK_STATE_SUBMITTED", "TASK_STATE_COMPLETED"]);
    const result = await invokeA2A(args, config, f.fetchImpl);
    expect(f.calls[0]!.url).toBe(`${endpoint}/.well-known/agent-card.json`);
    expect(f.calls.map((c) => c.body?.method)).toEqual([
      undefined,
      "SendMessage",
      "GetTask",
    ]);
    for (const call of f.calls) {
      expect(new URL(call.url).origin).toBe("http://gateway:4000");
      expect(call.headers.get("authorization")).toBe(
        "Bearer oauth-access-token",
      );
      expect(call.headers.get("x-letta-a2a-hop")).toBe("2");
    }
    expect(f.calls[1]!.body.params).toMatchObject({
      configuration: { returnImmediately: true },
      metadata: { lettaA2aLab: { hop: 2 } },
      message: { contextId: "ctx-existing" },
    });
    expect(result).toEqual({
      contextId: "ctx-existing",
      taskId: "task-1",
      text: "hi from B",
    });
  });
  test("rejects off-origin card advertisements before releasing credentials there", async () => {
    const f = fixture([], "https://private.invalid/rpc");
    await expect(invokeA2A(args, config, f.fetchImpl)).rejects.toThrow(
      "A2A operation failed",
    );
    expect(f.calls).toHaveLength(1);
  });
  for (const state of [
    "TASK_STATE_INPUT_REQUIRED",
    "TASK_STATE_AUTH_REQUIRED",
  ]) {
    test(`returns ${state} without polling, retaining continuation detail`, async () => {
      const f = fixture([state]);
      const result = await invokeA2A(args, config, f.fetchImpl);
      expect(result).toMatchObject({
        taskId: "task-1",
        contextId: "ctx-existing",
        status: state,
        statusMessage: "remote detail",
      });
      expect(f.calls).toHaveLength(2);
    });
  }
  test("caller cancellation uses package cancellation and fresh cleanup signal", async () => {
    const controller = new AbortController();
    const f = fixture(["TASK_STATE_WORKING"], endpoint, () =>
      setTimeout(() => controller.abort(), 5),
    );
    const error = await invokeA2A(
      args,
      { ...config, pollIntervalMs: 60_000 },
      f.fetchImpl,
      controller.signal,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(A2AInvocationCancelledError);
    expect(error.task.id).toBe("task-1");
    expect(error.cancellation.status.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(f.calls.map((c) => c.body?.method)).toEqual([
      undefined,
      "SendMessage",
      "CancelTask",
    ]);
    expect(f.calls[2]!.aborted).toBe(false);
  });
  test("timeout delegates bounded cancellation and preserves accepted task", async () => {
    const f = fixture(["TASK_STATE_WORKING"]);
    const error = await invokeA2A(
      args,
      { ...config, timeoutMs: 60, cancelTimeoutMs: 20, pollIntervalMs: 60_000 },
      f.fetchImpl,
    ).catch((e) => e);
    expect(error.message).toContain("timed out");
    expect(error.task.id).toBe("task-1");
    expect(error.cancellation.status.state).toBe(TaskState.TASK_STATE_CANCELED);
  });
  test("accepts an SDK message response without requiring a task", async () => {
    const result = await invokeA2A(args, config, async (_input, init) => {
      if (!init?.body) return Response.json(card());
      const request = JSON.parse(String(init.body));
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          message: {
            messageId: "reply",
            contextId: "ctx-existing",
            role: "ROLE_AGENT",
            parts: [{ text: "direct reply" }],
          },
        },
      });
    });
    expect(result).toEqual({
      contextId: "ctx-existing",
      taskId: undefined,
      text: "direct reply",
    });
  });
  test("preserves failed task status without placing private status text in the error message", async () => {
    const error = await invokeA2A(
      args,
      config,
      fixture(["TASK_STATE_FAILED"]).fetchImpl,
    ).catch((e) => e);
    expect(error.message).toBe("A2A task did not complete");
    expect(error.task.status.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(error.task.contextId).toBe("ctx-existing");
    expect(error.cause).toBeUndefined();
  });
  test("bounds uncooperative discovery and never submits after caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const f = fixture([]);
    await expect(
      invokeA2A(args, config, f.fetchImpl, controller.signal),
    ).rejects.toBeInstanceOf(A2AInvocationCancelledError);
    expect(f.calls).toHaveLength(0);
    const error = await invokeA2A(
      args,
      { ...config, timeoutMs: 50, cancelTimeoutMs: 10 },
      () => new Promise(() => {}),
    ).catch((e) => e);
    expect(error.message).toContain("timed out");
    expect(error.submissionAttempted).toBe(false);
  });
  test("invalid host hop defaults safely and explicit credential owners are accepted", async () => {
    const f = fixture(["TASK_STATE_COMPLETED"]);
    await invokeA2A(
      { ...args, hop: Infinity },
      {
        ...config,
        credentialOwner: {
          issuer: "host",
          subject: "caller",
          audience: "gateway",
        },
      },
      f.fetchImpl,
    );
    expect(f.calls[1]!.headers.get("x-letta-a2a-hop")).toBe("0");
    expect(f.calls[1]!.body.params.metadata.lettaA2aLab.hop).toBe(0);
  });
  test("does not disclose remote HTTP or OAuth error bodies through error causes", async () => {
    const error = await invokeA2A(
      args,
      config,
      async () => new Response("private-secret", { status: 500 }),
    ).catch((e) => e);
    expect(error.message).toBe("A2A operation failed");
    expect(error.cause).toBeUndefined();
    const oauthError = await invokeA2A(
      args,
      {
        ...config,
        tokenProvider: {
          getAccessToken: async () => {
            throw new Error("private-secret");
          },
        },
      },
      fixture([]).fetchImpl,
    ).catch((e) => e);
    expect(oauthError.message).toBe("A2A operation failed");
    expect(oauthError.cause).toBeUndefined();
  });
});
