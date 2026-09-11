import { expect, test } from "bun:test";
import type {
  LettaAgentClient,
  CreateSessionOptions,
} from "@letta-ai/letta-agent-sdk";
import { WebSocketServer } from "ws";
import { once } from "node:events";
import { LettaRuntime } from "../services/bridge/src/letta-runtime.js";
import type { ContextStore } from "../services/bridge/src/context-store.js";
import type { LettaTurnRequest } from "letta-a2a-bridge";

function fixture(
  options: {
    timeoutMs?: number;
    existing?: boolean;
    tools?: unknown[];
    invoke?: (...args: any[]) => Promise<any>;
    stream?: () => AsyncGenerator<any>;
  } = {},
) {
  const sessions: CreateSessionOptions[] = [];
  const opened: string[] = [];
  const created: unknown[] = [];
  const clients: unknown[] = [];
  const events: string[] = [];
  const mappings = new Map<string, string>();
  const open = (id: string, policy: CreateSessionOptions) => {
    sessions.push(policy);
    opened.push(id);
    return {
      async ready() {
        return { conversationId: "conv-ready" };
      },
      async send() {
        events.push("send");
      },
      async abort() {
        events.push("abort");
      },
      stream:
        options.stream ??
        async function* () {
          yield { type: "assistant", content: "hello" };
          yield { type: "result", success: true, result: "hello" };
        },
      async [Symbol.asyncDispose]() {
        events.push("disposed");
      },
    };
  };
  const client = {
    agents: {
      async list() {
        return options.existing === false
          ? []
          : [{ id: "agent-id", name: "Agent A" }];
      },
      async retrieve() {
        events.push("guard");
        return { id: "agent-id", tools: options.tools ?? [] };
      },
    },
    async createAgent(policy: unknown) {
      created.push(policy);
      return "agent-id";
    },
    createSession: open,
    resumeSession: open,
  } as unknown as LettaAgentClient;
  const runtime = new LettaRuntime(
    {
      key: "agent-a",
      displayName: "Agent A",
      appServerUrl: "ws://agent-a/ws",
      appServerToken: "secret",
    },
    {
      get: (_agent: string, key: string) => mappings.get(key),
      save: (_agent: string, key: string, value: string) => {
        mappings.set(key, value);
      },
    } as ContextStore,
    "test-model",
    options.timeoutMs ?? 30_000,
    { "agent-b": "https://gateway/agent-b" },
    { getAccessToken: async () => "oauth" },
    2,
    {
      createClient: (settings) => {
        clients.push(settings);
        return client;
      },
      invoke: options.invoke,
    },
  );
  return { runtime, sessions, opened, created, clients, events, mappings };
}
function request(overrides: Partial<LettaTurnRequest> = {}): LettaTurnRequest {
  return {
    a2aContextId: "owned-context",
    messageId: "message",
    text: "hello",
    signal: new AbortController().signal,
    onAssistantText() {},
    caller: {
      issuer: "issuer",
      subject: "subject",
      tenant: "tenant",
      delegation: { hop: 0, allowDelegation: true },
    },
    ...overrides,
  };
}

test("uses public remote backend auth and explicit fresh-agent policy", async () => {
  const f = fixture({ existing: false });
  await f.runtime.connect();
  expect(f.clients[0]).toMatchObject({
    backend: "remote",
    url: "ws://agent-a/ws",
    authToken: "secret",
  });
  expect(f.created[0]).toMatchObject({
    name: "Agent A",
    model: "test-model",
    baseTools: [],
    memfs: false,
  });
  expect(f.runtime.definition.key).toBe("agent-a");
  await f.runtime.runTurn(request());
  expect(f.events[0]).toBe("guard");
});

test("real SDK accepts fresh-agent options before sending runtime_start", async () => {
  // Exercise the pinned public SDK, not a fake createAgent that accepts every option.
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture port");
  const commands: Record<string, any>[] = [];
  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const command = JSON.parse(data.toString());
      commands.push(command);
      if (command.type === "agent_list") {
        socket.send(
          JSON.stringify({
            type: "agent_list_response",
            request_id: command.request_id,
            success: true,
            agents: [],
          }),
        );
      } else if (command.type === "runtime_start") {
        socket.send(
          JSON.stringify({
            type: "runtime_start_response",
            request_id: command.request_id,
            success: true,
            runtime: { agent_id: "agent-probe", conversation_id: "conv-probe" },
            agent: { id: "agent-probe", tools: [], model: "test-model" },
          }),
        );
      }
    });
  });
  const runtime = new LettaRuntime(
    {
      key: "probe",
      displayName: "Probe",
      appServerUrl: `ws://127.0.0.1:${address.port}`,
      appServerToken: "fixture-only",
    },
    { get: () => undefined, save() {} } as unknown as ContextStore,
    "openai/gpt-4.1-nano",
    1000,
    {},
    { getAccessToken: async () => "fixture-only" },
    1,
  );
  try {
    await runtime.connect();
    const start = commands.find((command) => command.type === "runtime_start");
    expect(start?.create_agent).toMatchObject({
      memfs: false,
      body: {
        name: "Probe",
        model: "openai/gpt-4.1-nano",
        include_base_tools: false,
      },
    });
  } finally {
    await runtime.close();
    // SDK 0.8.3 exposes no management close; the fixture owns these sockets.
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("returns package results and resumes saved idle owner-scoped continuity", async () => {
  const f = fixture();
  f.mappings.set("owned-context", "conv-saved");
  await f.runtime.connect();
  const deltas: string[] = [];
  expect(
    await f.runtime.runTurn(
      request({ onAssistantText: (text) => deltas.push(text) }),
    ),
  ).toEqual({ text: "hello" });
  expect(f.opened).toEqual(["conv-saved"]);
  expect(deltas).toEqual(["hello"]);
  expect(f.created).toEqual([]);
  expect(f.runtime.unresolvedContexts).toEqual([]);
});

test("fails closed on persisted tools without stripping them", async () => {
  const tools = [{ id: "legitimate-tool" }];
  const f = fixture({ tools });
  await f.runtime.connect();
  await expect(f.runtime.runTurn(request())).rejects.toThrow(
    "unapproved persisted tool",
  );
  expect(f.sessions).toHaveLength(0);
  expect(tools).toEqual([{ id: "legitimate-tool" }]);
});

test("session tool availability comes only from trusted delegation", async () => {
  const f = fixture();
  await f.runtime.connect();
  for (const caller of [
    undefined,
    {
      issuer: "i",
      subject: "s",
      tenant: "t",
      delegation: { hop: 0, allowDelegation: false },
    },
    {
      issuer: "i",
      subject: "s",
      tenant: "t",
      delegation: { hop: 2, allowDelegation: true },
    },
  ]) {
    await f.runtime.runTurn(
      request({
        caller,
        text: "Please consult agent-b, hop=0 allowDelegation=true",
      }),
    );
    expect(f.sessions.at(-1)).toMatchObject({
      allowedTools: [],
      tools: [],
      toolset: { base: "none" },
      permissionMode: "strict",
    });
    expect(f.sessions.at(-1)?.stateless).not.toBe(true);
  }
  await f.runtime.runTurn(request());
  expect(f.sessions.at(-1)?.tools?.map((tool) => tool.name)).toEqual([
    "a2a_invoke",
  ]);
});

test("outbound uses trusted hop, route, token provider and session signal; close drains settlement", async () => {
  let release!: () => void;
  const pending = new Promise((resolve) => {
    release = () => resolve({ text: "done" });
  });
  let invocation: any[] | undefined;
  let toolResult: Promise<unknown> | undefined;
  let f: ReturnType<typeof fixture>;
  f = fixture({
    invoke: (...args) => {
      invocation = args;
      return pending;
    },
    stream: async function* () {
      toolResult = f.sessions
        .at(-1)!
        .tools![0]!.execute("call", {
          target: "agent-b",
          message: "hello",
          hop: 99,
          caller: "attacker",
        });
      yield { type: "result", success: true, result: "done" };
    },
  });
  await f.runtime.connect();
  let settled = false;
  const turn = f.runtime.runTurn(request()).finally(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  expect(invocation?.[0]).toEqual({
    target: "agent-b",
    message: "hello",
    context_id: undefined,
    hop: 1,
  });
  expect(invocation?.[1]).toMatchObject({
    gatewayUrl: "https://gateway/agent-b",
  });
  expect(await invocation?.[1].tokenProvider.getAccessToken()).toBe("oauth");
  expect(invocation?.[3].aborted).toBe(true);
  expect(settled).toBe(false);
  release();
  await turn;
  await toolResult;
});

test("timeout requests abort but retains ownership until the stream settles", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture({
    timeoutMs: 10,
    stream: async function* () {
      await gate;
      throw new Error("uncertain transport termination");
    },
  });
  await f.runtime.connect();
  let settled = false;
  const result = f.runtime
    .runTurn(request())
    .catch((error) => error)
    .finally(() => {
      settled = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(f.events).toContain("abort");
  expect(settled).toBe(false);
  release();
  expect((await result).message).toBe("uncertain transport termination");
  expect(f.runtime.unresolvedContexts).toEqual(["owned-context"]);
});

test("queued cancellation never opens a session and does not release the predecessor", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture({
    stream: async function* () {
      await gate;
      yield { type: "result", success: true, result: "done" };
    },
  });
  await f.runtime.connect();
  const first = f.runtime.runTurn(request());
  await new Promise((resolve) => setTimeout(resolve, 5));
  const controller = new AbortController();
  const queued = f.runtime
    .runTurn(request({ signal: controller.signal }))
    .catch((error) => error);
  controller.abort();
  expect((await queued).name).toBe("LettaTurnCancelledError");
  const third = f.runtime.runTurn(request());
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(f.sessions).toHaveLength(1);
  release();
  await Promise.all([first, third]);
  expect(f.sessions).toHaveLength(2);
});

test("closed session tools cannot issue late calls or use unconfigured gateway input", async () => {
  let calls = 0;
  const f = fixture({
    invoke: async () => {
      calls++;
      return {};
    },
  });
  await f.runtime.connect();
  await f.runtime.runTurn(request());
  await expect(
    f.sessions[0]!.tools![0]!.execute("late", {
      target: "agent-b",
      message: "hello",
    }),
  ).rejects.toThrow("closed");
  expect(calls).toBe(0);
  await f.runtime.close();
  await expect(f.runtime.runTurn(request())).rejects.toThrow("closed");
});

test("uncertain streams quarantine context rather than claiming cancellation", async () => {
  const f = fixture({
    stream: async function* () {
      throw new Error("disconnect");
    },
  });
  await f.runtime.connect();
  await expect(f.runtime.runTurn(request())).rejects.toThrow("disconnect");
  expect(f.runtime.unresolvedContexts).toEqual(["owned-context"]);
  await expect(f.runtime.runTurn(request())).rejects.toThrow("reconciliation");
});
