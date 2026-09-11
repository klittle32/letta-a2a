import { test, expect } from "bun:test";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import {
  AGENT_CARD_PATH,
  AgentCard,
  SecurityScheme,
  SendMessageRequest,
  GetTaskRequest,
  ListTasksRequest,
  CancelTaskRequest,
  TaskPushNotificationConfig,
  GetTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigsRequest,
  DeleteTaskPushNotificationConfigRequest,
  TaskState,
  type Task,
} from "@a2a-js/sdk";
import { createA2AClient } from "../packages/letta-a2a-client/src/index.js";
import { ClientCredentialsTokenProvider } from "../services/bridge/src/oauth-client.js";
import {
  createBridge,
  listenLoopback,
  type BridgeOptions,
} from "../packages/letta-a2a-bridge/src/bridge.js";
import type { LettaTurnRunner } from "../packages/letta-a2a-bridge/src/letta-agent.js";
import { createPushNotifications } from "../packages/letta-a2a-bridge/src/push.js";
import { V1PushNotificationSerializer } from "@a2a-js/sdk/server";

// Deliberately test-owned OAuth issuer, not a package authentication implementation.
const audience = "phase3-bridge";
type Claims = {
  iss: string;
  sub: string;
  tenant: string;
  aud: string;
  exp: number;
  scope: string;
};
const identities: Record<string, Partial<Claims>> = {
  alice: { sub: "alice" },
  bob: { sub: "bob" },
  issuer: { sub: "alice", iss: "fixture-issuer-2" },
  tenant: { sub: "alice", tenant: "other" },
  observer: { sub: "observer", scope: "discover" },
  delegate: { sub: "delegate", scope: "discover execute delegate" },
};
async function http(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve()),
      );
      server.closeAllConnections();
      await closed;
    },
  };
}
async function oauth() {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const badKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const mint = (patch: Partial<Claims> = {}, bad = false) => {
    const claims: Claims = {
      iss: "fixture-issuer",
      sub: "alice",
      tenant: "team",
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 120,
      scope: "discover execute",
      ...patch,
    };
    const data = [{ alg: "RS256", typ: "JWT" }, claims]
      .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
      .join(".");
    return `${data}.${sign("RSA-SHA256", Buffer.from(data), bad ? badKeys.privateKey : keys.privateKey).toString("base64url")}`;
  };
  const validate = (header?: string): Claims => {
    if (!header?.startsWith("Bearer ")) throw new Error("unauthorized");
    const [h, p, s, extra] = header.slice(7).split(".");
    if (
      !h ||
      !p ||
      !s ||
      extra ||
      JSON.parse(Buffer.from(h, "base64url").toString()).alg !== "RS256" ||
      !verify(
        "RSA-SHA256",
        Buffer.from(`${h}.${p}`),
        keys.publicKey,
        Buffer.from(s, "base64url"),
      )
    )
      throw new Error("unauthorized");
    const c = JSON.parse(Buffer.from(p, "base64url").toString()) as Claims;
    if (
      !["fixture-issuer", "fixture-issuer-2"].includes(c.iss) ||
      c.aud !== audience ||
      !Number.isFinite(c.exp) ||
      c.exp <= Date.now() / 1000 ||
      !c.sub ||
      typeof c.tenant !== "string" ||
      typeof c.scope !== "string"
    )
      throw new Error("unauthorized");
    return c;
  };
  const issuer = await http((req, res) => {
    void (async () => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const credentials = Buffer.from(
        (req.headers.authorization ?? "").replace(/^Basic /, ""),
        "base64",
      )
        .toString()
        .split(":");
      const params = new URLSearchParams(body);
      if (
        req.url !== "/token" ||
        req.method !== "POST" ||
        credentials[1] !== "fixture-secret" ||
        !identities[credentials[0]!] ||
        params.get("grant_type") !== "client_credentials" ||
        params.get("scope") !== "a2a"
      ) {
        res.writeHead(401).end();
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          access_token: mint(identities[credentials[0]!]),
          token_type: "Bearer",
          expires_in: 120,
        }),
      );
    })().catch(() => res.writeHead(400).end());
  });
  const verified = new WeakMap<object, Claims>();
  const users = new WeakMap<
    object,
    Claims & { delegation?: { hop: number; allowDelegation: boolean } }
  >();
  const transport: NonNullable<BridgeOptions["transport"]> = {
    middleware: [
      (req, res, next) => {
        try {
          const c = validate(req.headers.authorization);
          const hop = req.headers["x-letta-a2a-hop"];
          if (
            hop !== undefined &&
            (!c.scope.split(" ").includes("delegate") ||
              typeof hop !== "string" ||
              !/^\d+$/.test(hop) ||
              !Number.isSafeInteger(Number(hop)))
          ) {
            res.status(403).end();
            return;
          }
          verified.set(req, c);
          next();
        } catch {
          res.status(401).end();
        }
      },
    ],
    userBuilder: async (req) => {
      const c = verified.get(req);
      if (!c) return { isAuthenticated: false, userName: "" };
      const user = { isAuthenticated: true, userName: c.sub };
      const hop = req.headers["x-letta-a2a-hop"];
      users.set(user, {
        ...c,
        ...(hop === undefined
          ? {}
          : { delegation: { hop: Number(hop), allowDelegation: true } }),
      });
      return user;
    },
  };
  const auth: NonNullable<BridgeOptions["auth"]> = {
    projectCaller(context) {
      const c = context.user && users.get(context.user);
      if (!c) return undefined;
      const caller = {
        issuer: c.iss,
        subject: c.sub,
        tenant: c.tenant,
        delegation: c.delegation,
      };
      return caller;
    },
    authorize({ context, operation }) {
      const claims = context.user && users.get(context.user);
      return (claims?.scope ?? "")
        .split(" ")
        .includes(operation === "discover" ? "discover" : "execute");
    },
  };
  return {
    ...issuer,
    mint,
    transport,
    auth,
    token(id: string) {
      return new ClientCredentialsTokenProvider({
        tokenUrl: `${issuer.url}/token`,
        clientId: id,
        clientSecret: "fixture-secret",
        scope: "a2a",
        exchangeTimeoutMs: 1000,
      });
    },
  };
}
function request(text = "done", patch: Record<string, unknown> = {}) {
  return SendMessageRequest.fromJSON({
    message: {
      messageId: crypto.randomUUID(),
      role: "ROLE_USER",
      contextId: "wire-context",
      parts: [{ text }],
      ...patch,
    },
  });
}
function task(result: unknown): Task {
  assert(result && typeof result === "object" && "status" in result);
  return result as Task;
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("integration wait exceeded 2 seconds")),
          2000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function fixture(runner: LettaTurnRunner, push?: BridgeOptions["push"]) {
  const issuer = await oauth();
  try {
    const bridge = createBridge({
      sharingDomain: "phase3",
      publicBaseUrl: "http://localhost",
      runner,
      auth: issuer.auth,
      security: {
        securitySchemes: {
          oauth: SecurityScheme.fromJSON({
            oauth2SecurityScheme: {
              description:
                "Fixture client credentials; granted actions depend on client role",
              flows: {
                clientCredentials: {
                  tokenUrl: `${issuer.url}/token`,
                  scopes: { a2a: "Role-scoped A2A access" },
                },
              },
            },
          }),
        },
        securityRequirements: [{ schemes: { oauth: { list: ["a2a"] } } }],
      },
      transport: issuer.transport,
      push,
    });
    const listener = await listenLoopback(bridge);
    return {
      ...listener,
      issuer,
      async client(id = "alice", headers?: Record<string, string>) {
        const provider = issuer.token(id);
        const owner = id;
        return createA2AClient({
          routes: { bridge: listener.url },
          timeoutMs: 2000,
          routePolicies: {
            bridge: {
              destinationOrigins: [listener.url],
              peerIdentity: "phase3",
              headers,
              credential: {
                owner,
                audience,
                origins: [listener.url],
                headerNames: ["Authorization"],
                async provide({ signal }) {
                  return {
                    owner,
                    audience,
                    headers: {
                      Authorization: `Bearer ${await provider.getAccessToken(signal)}`,
                    },
                  };
                },
              },
            },
          },
        }).connect("bridge", AbortSignal.timeout(2000));
      },
      async close() {
        try {
          await listener.close();
        } finally {
          await issuer.close();
        }
      },
    };
  } catch (error) {
    await issuer.close();
    throw error;
  }
}

test("HTTP OAuth rejects invalid JWTs on discovery and every RPC; observer cannot execute", async () => {
  let calls = 0;
  const f = await fixture({
    async runTurn() {
      calls++;
      return { text: "done" };
    },
  });
  try {
    const tokens = [
      undefined,
      f.issuer.mint({}, true),
      f.issuer.mint({ exp: 1 }),
      f.issuer.mint({ iss: "untrusted" }),
      f.issuer.mint({ aud: "other" }),
    ];
    const methods = [
      "SendMessage",
      "SendStreamingMessage",
      "GetTask",
      "ListTasks",
      "CancelTask",
      "SubscribeToTask",
      "CreateTaskPushNotificationConfig",
      "GetTaskPushNotificationConfig",
      "ListTaskPushNotificationConfigs",
      "DeleteTaskPushNotificationConfig",
      "GetExtendedAgentCard",
    ];
    for (const token of tokens) {
      const headers = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
        "A2A-Version": "1.0",
      };
      expect(
        (
          await fetch(`${f.url}/${AGENT_CARD_PATH}`, {
            headers,
            signal: AbortSignal.timeout(2000),
          })
        ).status,
      ).toBe(401);
      for (const method of methods)
        expect(
          (
            await fetch(f.url, {
              method: "POST",
              headers,
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method,
                params: {},
              }),
              signal: AbortSignal.timeout(2000),
            })
          ).status,
        ).toBe(401);
    }
    const observer = await f.client("observer");
    await expect(observer.sendMessage(request())).rejects.toThrow();
    expect(calls).toBe(0);
  } finally {
    await f.close();
  }
}, 15000);

test("authenticated discovery is not publicly cacheable", async () => {
  const f = await fixture({
    async runTurn() {
      return { text: "done" };
    },
  });
  try {
    const response = await fetch(`${f.url}/${AGENT_CARD_PATH}`, {
      headers: {
        Authorization: `Bearer ${await f.issuer.token("observer").getAccessToken()}`,
      },
      signal: AbortSignal.timeout(2000),
    });
    await response.arrayBuffer();
    expect(response.headers.get("cache-control")).toContain("no-store");
  } finally {
    await f.close();
  }
});

test("concurrent tokens for one principal retain their own OAuth scopes", async () => {
  let calls = 0;
  const f = await fixture({
    async runTurn() {
      calls++;
      return { text: "done" };
    },
  });
  try {
    const responses = await Promise.all(
      ["discover", "discover execute"].map(async (scope) => {
        const response = await fetch(f.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "A2A-Version": "1.0",
            Authorization: `Bearer ${f.issuer.mint({ sub: "same", scope })}`,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: scope,
            method: "SendMessage",
            params: SendMessageRequest.toJSON(request()),
          }),
          signal: AbortSignal.timeout(2000),
        });
        return response.json();
      }),
    );
    expect(responses[0].error).toBeDefined();
    expect(responses[1].result).toBeDefined();
    expect(calls).toBe(1);
  } finally {
    await f.close();
  }
});

test("authenticated discovery advertises a non-anonymous security requirement", async () => {
  const f = await fixture({
    async runTurn() {
      return { text: "done" };
    },
  });
  try {
    const response = await fetch(`${f.url}/${AGENT_CARD_PATH}`, {
      headers: {
        Authorization: `Bearer ${await f.issuer.token("observer").getAccessToken()}`,
      },
      signal: AbortSignal.timeout(2000),
    });
    expect(response.status).toBe(200);
    const card = AgentCard.fromJSON(await response.json());
    const scheme = card.securitySchemes.oauth?.scheme;
    assert(scheme?.$case === "oauth2SecurityScheme");
    const flow = scheme.value.flows?.flow;
    assert(flow?.$case === "clientCredentials");
    expect(flow.value.tokenUrl).toBe(`${f.issuer.url}/token`);
    expect(flow.value.scopes).toEqual({ a2a: "Role-scoped A2A access" });
    expect(card.securityRequirements).toEqual([
      { schemes: { oauth: { list: ["a2a"] } } },
    ]);
  } finally {
    await f.close();
  }
});

test("official clients isolate subject, issuer and tenant task ownership and runner contexts", async () => {
  const keys: string[] = [];
  const f = await fixture({
    async runTurn(r) {
      keys.push(r.a2aContextId);
      return { text: "wait", state: "input_required" };
    },
  });
  try {
    const clients = await Promise.all(
      ["alice", "bob", "issuer", "tenant"].map((id) => f.client(id)),
    );
    const tasks = await Promise.all(
      clients.map((client) => client.sendMessage(request()).then(task)),
    );
    expect(new Set(keys).size).toBe(4);
    expect(new Set(tasks.map((t) => t.contextId))).toEqual(
      new Set(["wire-context"]),
    );
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i]!;
      const own = tasks[i]!;
      const other = tasks[(i + 1) % tasks.length]!;
      expect(
        (await client.getTask(GetTaskRequest.fromJSON({ id: own.id }))).id,
      ).toBe(own.id);
      expect(
        (
          await client.listTasks(
            ListTasksRequest.fromJSON({ contextId: "wire-context" }),
          )
        ).tasks.map((t) => t.id),
      ).toEqual([own.id]);
      await expect(
        client.getTask(GetTaskRequest.fromJSON({ id: other.id })),
      ).rejects.toThrow();
      await expect(
        client.cancelTask(CancelTaskRequest.fromJSON({ id: other.id })),
      ).rejects.toThrow();
      await expect(
        bounded(
          client
            .resubscribeTask(
              { id: other.id, tenant: "" },
              { signal: AbortSignal.timeout(2000) },
            )
            .next(),
        ),
      ).rejects.toThrow(/not found/i);
    }
    const spoof = request("done", {
      taskId: tasks[0]!.id,
      metadata: { issuer: "fixture-issuer", subject: "alice", tenant: "team" },
    });
    await expect(clients[1]!.sendMessage(spoof)).rejects.toThrow();
    const tenantSpoof = request();
    tenantSpoof.tenant = "other";
    await expect(clients[0]!.sendMessage(tenantSpoof)).rejects.toThrow();
    expect(keys.length).toBe(4);
    for (let i = 0; i < clients.length; i++)
      expect(
        (
          await clients[i]!.cancelTask(
            CancelTaskRequest.fromJSON({ id: tasks[i]!.id }),
          )
        ).status?.state,
      ).toBe(TaskState.TASK_STATE_CANCELED);
  } finally {
    await f.close();
  }
}, 15000);

for (const state of ["input_required", "auth_required"] as const)
  test(`HTTP ${state} continuation, streaming snapshot, history, filters and terminal rejection`, async () => {
    let calls = 0;
    const f = await fixture({
      async runTurn(r) {
        calls++;
        r.onAssistantText("public reply");
        return {
          text: "public reply",
          state: r.text === "wait" ? state : "completed",
        };
      },
    });
    try {
      const client = await f.client();
      const events = await bounded(
        (async () => {
          const events = [];
          for await (const e of client.sendMessageStream(request("wait")))
            events.push(e);
          return events;
        })(),
      );
      const first = events[0]?.payload;
      assert(first?.$case === "task");
      const id = first.value.id;
      const current = await client.getTask(GetTaskRequest.fromJSON({ id }));
      expect(current.status?.state).toBe(
        state === "input_required"
          ? TaskState.TASK_STATE_INPUT_REQUIRED
          : TaskState.TASK_STATE_AUTH_REQUIRED,
      );
      const subscription = client.resubscribeTask(
        { id, tenant: "" },
        { signal: AbortSignal.timeout(2000) },
      );
      try {
        const snapshot = (await bounded(subscription.next())).value?.payload;
        assert(snapshot?.$case === "task");
        expect(snapshot.value.status?.state).toBe(current.status?.state);
        const next = bounded(subscription.next());
        const done = task(
          await client.sendMessage(request("done", { taskId: id })),
        );
        expect(done.id).toBe(id);
        expect(done.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
        await next;
        await bounded(
          (async () => {
            while (!(await subscription.next()).done) {
              /* drain terminal stream */
            }
          })(),
        );
      } finally {
        await subscription.return?.();
      }
      await expect(
        bounded(
          client
            .resubscribeTask(
              { id, tenant: "" },
              { signal: AbortSignal.timeout(2000) },
            )
            .next(),
        ),
      ).rejects.toThrow(/terminal/i);
      const filtered = await client.listTasks(
        ListTasksRequest.fromJSON({
          contextId: "wire-context",
          historyLength: 0,
          includeArtifacts: false,
        }),
      );
      expect(filtered.tasks.map((t) => t.id)).toEqual([id]);
      expect(filtered.tasks[0]!.history).toEqual([]);
      expect(filtered.tasks[0]!.artifacts).toEqual([]);
      const full = await client.getTask(GetTaskRequest.fromJSON({ id }));
      expect(full.history.length).toBeGreaterThanOrEqual(2);
      expect(full.artifacts.length).toBeGreaterThan(0);
      expect(
        (
          await client.getTask(
            GetTaskRequest.fromJSON({ id, historyLength: 1 }),
          )
        ).history.length,
      ).toBe(1);
      expect(
        (
          await client.listTasks(
            ListTasksRequest.fromJSON({ contextId: "missing" }),
          )
        ).tasks,
      ).toEqual([]);
      const media = request();
      media.configuration = {
        acceptedOutputModes: ["image/png"],
        historyLength: undefined,
        returnImmediately: false,
        taskPushNotificationConfig: undefined,
      };
      await expect(client.sendMessage(media)).rejects.toThrow();
      const mixed = request();
      mixed.message!.parts.push({
        ...mixed.message!.parts[0]!,
        content: { $case: "url", value: "https://example.invalid/file" },
      });
      await expect(client.sendMessage(mixed)).rejects.toThrow();
      expect(calls).toBe(2);
    } finally {
      await f.close();
    }
  }, 15000);

test("host client headers propagate only role-authorized delegation context", async () => {
  const hops: (number | undefined)[] = [];
  const f = await fixture({
    async runTurn(r) {
      hops.push(r.caller?.delegation?.hop);
      return { text: "done" };
    },
  });
  try {
    const delegate = await f.client("delegate", { "x-letta-a2a-hop": "2" });
    await delegate.sendMessage(
      request("done", { metadata: { hop: 0, delegation: { hop: 0 } } }),
    );
    expect(hops).toEqual([2]);
    await expect(
      delegate.sendMessage(request(), {
        signal: AbortSignal.timeout(2000),
        serviceParameters: { "x-letta-a2a-hop": "0" },
      }),
    ).rejects.toThrow();
    expect(hops).toEqual([2]);
    const response = await fetch(f.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await f.issuer.token("alice").getAccessToken()}`,
        "x-letta-a2a-hop": "0",
        "Content-Type": "application/json",
        "A2A-Version": "1.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "SendMessage",
        params: SendMessageRequest.toJSON(request()),
      }),
      signal: AbortSignal.timeout(2000),
    });
    expect(response.status).toBe(403);
    expect(hops).toEqual([2]);
  } finally {
    await f.close();
  }
});

test("async HTTP sends and governed push CRUD deliver exact Bearer V1 callback without credential echo", async () => {
  const deliveries: {
    authorization?: string;
    body: Record<string, unknown>;
  }[] = [];
  const callback = await http((req, res) => {
    void (async () => {
      let body = "";
      for await (const chunk of req) body += chunk;
      deliveries.push({
        authorization: req.headers.authorization,
        body: JSON.parse(body),
      });
      res.writeHead(204).end();
    })().catch(() => res.writeHead(400).end());
  });
  const push = createPushNotifications({
    callbacks: [
      { url: `${callback.url}/events`, bearerToken: "fixture-callback" },
    ],
    timeoutMs: 1000,
    retryCount: 0,
    closeTimeoutMs: 1000,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let f: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    const expectedBodies: string[] = [];
    f = await fixture(
      {
        async runTurn() {
          await gate;
          return { text: "done" };
        },
      },
      {
        ...push,
        sender: {
          async send(event, context) {
            expectedBodies.push(
              new V1PushNotificationSerializer().serialize(event).body,
            );
            await push.sender.send(event, context);
          },
        },
      },
    );
    const client = await f.client();
    const other = await f.client("bob");
    const input = request();
    input.configuration = {
      returnImmediately: true,
      acceptedOutputModes: [],
      historyLength: undefined,
      taskPushNotificationConfig: undefined,
    };
    const running = task(await bounded(client.sendMessage(input)));
    expect(running.status?.state).not.toBe(TaskState.TASK_STATE_COMPLETED);
    const config = TaskPushNotificationConfig.fromJSON({
      taskId: running.id,
      id: "callback",
      url: `${callback.url}/events`,
      authentication: { scheme: "Bearer", credentials: "fixture-callback" },
    });
    const created = await client.createTaskPushNotificationConfig(config);
    expect(JSON.stringify(created)).not.toContain("fixture-callback");
    const params = { taskId: running.id, id: created.id };
    const got = await client.getTaskPushNotificationConfig(
      GetTaskPushNotificationConfigRequest.fromJSON(params),
    );
    expect(got.url).toBe(config.url);
    expect(JSON.stringify(got)).not.toContain("fixture-callback");
    const listed = await client.listTaskPushNotificationConfig(
      ListTaskPushNotificationConfigsRequest.fromJSON({ taskId: running.id }),
    );
    expect(JSON.stringify(listed)).not.toContain("fixture-callback");
    await expect(
      other.getTaskPushNotificationConfig(
        GetTaskPushNotificationConfigRequest.fromJSON(params),
      ),
    ).rejects.toThrow();
    await expect(
      other.deleteTaskPushNotificationConfig(
        DeleteTaskPushNotificationConfigRequest.fromJSON(params),
      ),
    ).rejects.toThrow();
    release();
    await bounded(
      (async () => {
        while (
          !deliveries.some((d) =>
            JSON.stringify(d.body).includes("TASK_STATE_COMPLETED"),
          )
        )
          await new Promise((resolve) => setTimeout(resolve, 10));
      })(),
    );
    for (const delivery of deliveries) {
      expect(delivery.authorization === "Bearer fixture-callback").toBe(true);
      expect(expectedBodies.map((body) => JSON.parse(body))).toContainEqual(
        delivery.body,
      );
      expect(delivery.body).not.toHaveProperty("jsonrpc");
      expect(delivery.body).not.toHaveProperty("payload");
      expect(JSON.stringify(delivery.body)).not.toContain("fixture-callback");
      expect(
        Object.keys(delivery.body).some((key) =>
          ["task", "statusUpdate", "artifactUpdate"].includes(key),
        ),
      ).toBe(true);
    }
    await client.deleteTaskPushNotificationConfig(
      DeleteTaskPushNotificationConfigRequest.fromJSON(params),
    );
    await expect(
      client.getTaskPushNotificationConfig(
        GetTaskPushNotificationConfigRequest.fromJSON(params),
      ),
    ).rejects.toThrow();
  } finally {
    release();
    try {
      await f?.close();
    } finally {
      await push.close();
      await callback.close();
    }
  }
}, 15000);
