import { expect, test } from "bun:test";
import { createOfficialClientProvider } from "../src/a2a-invoker.js";
import { createA2AClient, FileContextStore } from "../src/index.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { compilePolicy, type ClientRoutePolicy } from "../src/client-policy.js";

for (const rejected of ["401", "redirect", "url"] as const) {
  test(`rejected ${rejected} response cancels its body without awaiting cleanup`, async () => {
    let canceled = 0;
    const response = new Response(
      new ReadableStream({
        cancel() {
          canceled++;
          return new Promise<void>(() => {});
        },
      }),
      {
        status: rejected === "401" ? 401 : rejected === "redirect" ? 302 : 200,
      },
    );
    if (rejected === "url")
      Object.defineProperty(response, "url", { value: "https://evil.test/" });
    const guarded = compilePolicy(policy()).fetch(
      Object.assign(async () => response, fetch),
      100,
    );
    const error = await guarded("https://agent.test/").catch((error) => error);
    expect(error.message).toBe("A2A policy request failed");
    expect(canceled).toBe(1);
  });
}

test("protected Request and init headers are each checked before custom fetch", async () => {
  let calls = 0;
  const p = policy();
  delete p.credential;
  delete p.headers;
  const guarded = compilePolicy(p).fetch(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        calls++;
        return new Response(
          new Request(input, init).headers.get("authorization"),
        );
      },
      fetch,
    ),
    100,
  );
  const variants: RequestInit[] = [
    {},
    { headers: {} },
    { headers: { accept: "application/json" } },
  ];
  for (const init of variants) {
    await expect(
      guarded(new Request(url, { headers: { Authorization: "secret" } }), init),
    ).rejects.toThrow("A2A policy request failed");
  }
  await expect(
    guarded(new Request(url), { headers: { Authorization: "secret" } }),
  ).rejects.toThrow("A2A policy request failed");
  expect(calls).toBe(0);
});
const url = "https://agent.test/";
const card = (endpoint = `${url}rpc`) => ({
  name: "test",
  description: "test",
  version: "1",
  supportedInterfaces: [
    { url: endpoint, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
  ],
  capabilities: {},
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [],
});
const policy = (): ClientRoutePolicy => ({
  destinationOrigins: [url],
  peerIdentity: "peer",
  credential: {
    owner: "owner",
    audience: "a2a",
    origins: [url],
    headerNames: ["Authorization"],
    provide: async () => ({
      owner: "owner",
      audience: "a2a",
      headers: { Authorization: "Bearer secret" },
    }),
  },
  headers: { "x-hop": "2" },
});
const fixture = (
  p: ClientRoutePolicy,
  handler?: (init?: RequestInit) => Response,
  timeout = 100,
) =>
  createOfficialClientProvider({
    policies: { [url]: p },
    discoveryTimeoutMs: timeout,
    fetchImpl: Object.assign(
      async (_: unknown, init?: RequestInit) =>
        handler ? handler(init) : Response.json(card()),
      fetch,
    ),
  });
test("credentials and trusted headers apply and official calls cannot spoof them", async () => {
  const client = await fixture(policy(), (init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer secret",
    );
    expect(new Headers(init?.headers).get("x-hop")).toBe("2");
    return Response.json(card());
  })(url);
  await expect(
    client.getTask(
      { tenant: "", id: "t", historyLength: 0 },
      { serviceParameters: { Authorization: "evil" } },
    ),
  ).rejects.toThrow();
  await expect(
    client.getTask(
      { tenant: "", id: "t", historyLength: 0 },
      { serviceParameters: { "x-hop": "0" } },
    ),
  ).rejects.toThrow();
});
test("a connected client refreshes tokens but rejects an owner change before fetch", async () => {
  const p = policy();
  let owner = "owner";
  let generation = 0;
  let requests = 0;
  p.credential!.headerNames = ["x-api-key"];
  p.credential!.provide = async () => ({
    owner,
    audience: "a2a",
    headers: { "x-api-key": `secret-${++generation}` },
  });
  const client = await fixture(p, (init) => {
    requests++;
    expect(new Headers(init?.headers).get("x-api-key")).toBe(
      `secret-${generation}`,
    );
    if (init?.method !== "POST") return Response.json(card());
    const body = JSON.parse(String(init.body));
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        id: "t",
        contextId: "c",
        status: { state: "TASK_STATE_COMPLETED" },
      },
    });
  })(url);
  await client.getTask({ tenant: "", id: "t", historyLength: 0 });
  expect(generation).toBe(2);
  await expect(
    client.getTask(
      { tenant: "", id: "t", historyLength: 0 },
      { serviceParameters: { "X-API-Key": "spoof" } },
    ),
  ).rejects.toThrow();
  owner = "changed";
  await expect(
    client.getTask({ tenant: "", id: "t", historyLength: 0 }),
  ).rejects.toThrow();
  expect(requests).toBe(2);
});

test("unapproved advertisements and redirects fail closed", async () => {
  await expect(
    fixture(policy(), () => Response.json(card("https://evil.test/rpc")))(url),
  ).rejects.toThrow();
  await expect(
    fixture(
      policy(),
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.test" },
        }),
    )(url),
  ).rejects.toThrow();
});
test("provider failure is sanitized and not cached; refresh must confirm owner", async () => {
  const p = policy();
  let calls = 0;
  p.credential!.provide = async () => {
    if (!calls++) throw new Error("secret");
    return {
      owner: "owner",
      audience: "a2a",
      headers: { Authorization: `Bearer token-${calls}` },
    };
  };
  const provider = fixture(p);
  const error = await provider(url).catch((e) => e);
  expect(JSON.stringify(error)).not.toContain("secret");
  await provider(url);
  await provider(url);
  p.credential!.provide = async () => ({
    owner: "other",
    audience: "a2a",
    headers: { Authorization: "secret" },
  });
  await expect(fixture(p)(url)).rejects.toThrow();
});
test("authentication shares bounded discovery lifetime", async () => {
  const p = policy();
  p.credential!.provide = () => new Promise(() => {});
  const start = Date.now();
  await expect(fixture(p, undefined, 20)(url)).rejects.toThrow();
  expect(Date.now() - start).toBeLessThan(200);
});
test("same URL alias policy conflicts require separate clients", () => {
  expect(() =>
    createA2AClient({
      routes: { a: url, b: url },
      routePolicies: { a: policy() },
    }),
  ).toThrow();
  const p = policy();
  expect(() =>
    createA2AClient({
      routes: { a: url, b: url },
      routePolicies: { a: p, b: p },
    }),
  ).not.toThrow();
});

test("credential scope is separate from approved destinations", async () => {
  const p = policy();
  p.destinationOrigins = [url, "https://other.test"];
  const requests: string[] = [];
  const provider = createOfficialClientProvider({
    policies: { [url]: p },
    fetchImpl: Object.assign(
      async (request: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const target = String(request);
        requests.push(target);
        if (init?.method !== "POST")
          return Response.json(card("https://other.test/rpc"));
        expect(new Headers(init.headers).has("authorization")).toBe(false);
        const body = JSON.parse(String(init.body));
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            id: "t",
            contextId: "c",
            status: { state: "TASK_STATE_COMPLETED" },
          },
        });
      },
      fetch,
    ),
  });
  const client = await provider(url);
  await client.getTask({ tenant: "", id: "t", historyLength: 0 });
  expect(requests).toHaveLength(2);
});

test("configured destinations reject URL credentials and fragments", async () => {
  for (const target of ["https://u:p@agent.test/", `${url}#secret`]) {
    let calls = 0;
    const provider = createOfficialClientProvider({
      fetchImpl: Object.assign(async () => {
        calls++;
        return Response.json(card());
      }, fetch),
    });
    await expect(provider(target)).rejects.toThrow();
    expect(calls).toBe(0);
  }
});

test("official extended cards cannot advertise an unapproved destination", async () => {
  const client = await fixture(policy(), (init) => {
    if (init?.method !== "POST")
      return Response.json({
        ...card(),
        capabilities: { extendedAgentCard: true },
      });
    const body = JSON.parse(String(init.body));
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: card("https://evil.test/rpc"),
    });
  })(url);
  await expect(client.getAgentCard()).rejects.toThrow();
});

test("401 is never retried and response secrets stay out of errors", async () => {
  let sends = 0;
  const client = await fixture(policy(), (init) => {
    if (init?.method !== "POST") return Response.json(card());
    sends++;
    return new Response("Bearer secret", { status: 401 });
  })(url);
  const error = await client
    .getTask({ tenant: "", id: "t", historyLength: 0 })
    .catch((e) => e);
  expect(sends).toBe(1);
  expect(inspect(error)).not.toContain("Bearer secret");
});

test("disk continuity separates owners, shares aliases, and never stores credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "a2a-policy-"));
  const path = join(directory, "contexts.json");
  const received: string[] = [];
  let count = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request): Promise<Response> {
      if (request.method !== "POST")
        return Response.json(card(`${server.url}rpc`));
      const body = (await request.json()) as {
        id: string;
        params: { message: { contextId?: string } };
      };
      received.push(body.params.message.contextId ?? "");
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          message: {
            messageId: `m${++count}`,
            role: "ROLE_AGENT",
            contextId: body.params.message.contextId || `c${count}`,
            parts: [{ text: "ok" }],
          },
        },
      });
    },
  });
  try {
    const endpoint = server.url.href;
    const make = (owner: string) => {
      const p = policy();
      p.destinationOrigins = [endpoint];
      p.credential!.origins = [endpoint];
      p.credential!.owner = owner;
      p.credential!.provide = async () => ({
        owner,
        audience: "a2a",
        headers: { Authorization: `Bearer secret-${owner}-${count}` },
      });
      return createA2AClient({
        routes: { a: endpoint, b: endpoint },
        routePolicies: { a: p, b: p },
        contextStore: new FileContextStore(path),
      });
    };
    const first = make("one");
    const signal = new AbortController().signal;
    await first.invoke({
      target: "a",
      localScope: "local",
      message: "hello",
      signal,
    });
    await first.invoke({
      target: "b",
      localScope: "local",
      message: "again",
      signal,
    });
    await make("two").invoke({
      target: "a",
      localScope: "local",
      message: "hello",
      signal,
    });
    await make("one").invoke({
      target: "a",
      localScope: "local",
      message: "refresh",
      signal,
    });
    expect(received).toEqual(["", "c1", "", "c1"]);
    const disk = await readFile(path, "utf8");
    expect(disk).not.toContain("secret");
    expect(disk).not.toContain("Authorization");
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});
