import { expect, test } from "bun:test";
import { Message, TaskState } from "@a2a-js/sdk";
import {
  A2AInvocationCancelledError,
  A2AInvocationError,
  createOfficialClientProvider,
  PollingA2AInvoker,
} from "../src/a2a-invoker.js";

const url = "https://agent.test";
const card = (endpoint = `${url}/rpc`) => ({
  name: "test",
  description: "offline fixture",
  version: "1",
  supportedInterfaces: [
    { url: endpoint, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
  ],
  capabilities: { streaming: true },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["application/json"],
  skills: [],
});
const fakeFetch = (
  implementation: (
    request: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
): typeof fetch => Object.assign(implementation, fetch);

test("official discovery has a deadline even when fetch ignores cancellation", async () => {
  const provider = createOfficialClientProvider({
    fetchImpl: fakeFetch(() => new Promise(() => {})),
    discoveryTimeoutMs: 20,
  });
  const start = Date.now();
  const error = await provider(url).catch((e) => e);
  expect(error).toBeInstanceOf(A2AInvocationError);
  expect(error.submissionAttempted).toBe(false);
  expect(error.message).toContain("timed out");
  expect(Date.now() - start).toBeLessThan(200);
});

test("official discovery responds to caller abort without sending", async () => {
  const controller = new AbortController();
  const provider = createOfficialClientProvider({
    fetchImpl: fakeFetch(() => new Promise(() => {})),
  });
  const pending = provider(url, controller.signal);
  controller.abort();
  expect(await pending.catch((e) => e)).toBeInstanceOf(
    A2AInvocationCancelledError,
  );
});

test("rejects cross-origin advertisements and non-HTTP routes before transport", async () => {
  let calls = 0;
  const provider = createOfficialClientProvider({
    fetchImpl: fakeFetch(async () => {
      calls++;
      return Response.json(card("https://other.test/rpc"));
    }),
  });
  await expect(provider(url)).rejects.toBeInstanceOf(A2AInvocationError);
  expect(calls).toBe(1);
  await expect(provider("file:///tmp/card")).rejects.toBeInstanceOf(
    A2AInvocationError,
  );
  expect(calls).toBe(1);
});

test("official JSONRPC clients do not retain discovery signals or follow redirects", async () => {
  let discoveries = 0;
  const signals: (AbortSignal | null | undefined)[] = [];
  const provider = createOfficialClientProvider({
    fetchImpl: fakeFetch(async (_request, init) => {
      expect(init?.redirect).toBe("error");
      if (init?.method !== "POST") {
        discoveries++;
        signals.push(init?.signal);
        return Response.json(card());
      }
      expect(init.signal?.aborted).not.toBe(true);
      expect(signals).not.toContain(init.signal);
      const request = JSON.parse(String(init.body));
      expect(request.method).toBe("GetTask");
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          id: "t",
          contextId: "c",
          status: { state: "TASK_STATE_COMPLETED" },
          metadata: { preserved: true },
        },
      });
    }),
  });
  const controller = new AbortController();
  const first = await provider(url, controller.signal);
  controller.abort();
  const second = await provider(url);
  expect(first).not.toBe(second);
  expect(discoveries).toBe(2);
  const result = await first.getTask({ tenant: "", id: "t", historyLength: 0 });
  expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
  expect(result.metadata).toEqual({ preserved: true });
});

test("official send and SSE subscription preserve typed SDK content and events", async () => {
  const wireMessage = {
    messageId: "answer",
    role: "ROLE_AGENT",
    metadata: { typed: true },
    parts: [
      { data: { answer: [1, true] }, mediaType: "application/json" },
      { raw: "AQI=", mediaType: "image/png" },
      { url: "https://files.test/a", filename: "a" },
    ],
  };
  const provider = createOfficialClientProvider({
    fetchImpl: fakeFetch(async (_request, init) => {
      if (init?.method !== "POST") return Response.json(card());
      const request = JSON.parse(String(init.body));
      if (request.method === "SendMessage") {
        expect(request.params.configuration.returnImmediately).toBe(true);
        expect(request.params.message.metadata).toEqual({ request: true });
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result: { message: wireMessage },
        });
      }
      expect(["SendStreamingMessage", "SubscribeToTask"]).toContain(
        request.method,
      );
      const events = [
        {
          task: {
            id: "t",
            contextId: "c",
            status: { state: "TASK_STATE_WORKING" },
          },
        },
        {
          artifactUpdate: {
            taskId: "t",
            contextId: "c",
            artifact: { artifactId: "a", parts: wireMessage.parts },
            append: true,
            lastChunk: true,
          },
        },
        {
          statusUpdate: {
            taskId: "t",
            contextId: "c",
            status: { state: "TASK_STATE_COMPLETED" },
            metadata: { final: true },
          },
        },
      ];
      return new Response(
        events
          .map(
            (result) =>
              `data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n\n`,
          )
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    }),
  });
  const runner = new PollingA2AInvoker(provider, {
    timeoutMs: 500,
    pollIntervalMs: 1,
  });
  const input = {
    url,
    message: Message.fromJSON({
      messageId: "input",
      role: "ROLE_USER",
      metadata: { request: true },
    }),
    signal: new AbortController().signal,
  };
  expect(await runner.invoke(input)).toEqual(Message.fromJSON(wireMessage));
  for (const stream of [runner.stream(input), runner.subscribe(url, "t")]) {
    const events = [];
    for await (const event of stream) events.push(event);
    expect(events.map((event) => event.payload?.$case)).toEqual([
      "task",
      "artifactUpdate",
      "statusUpdate",
    ]);
    const artifact = events[1]?.payload;
    if (artifact?.$case !== "artifactUpdate") throw Error("Missing artifact");
    expect(artifact.value.artifact?.parts).toEqual(
      Message.fromJSON(wireMessage).parts,
    );
    expect(artifact.value.append).toBe(true);
    expect(artifact.value.lastChunk).toBe(true);
  }
});
