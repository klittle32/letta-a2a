import { test, expect } from "bun:test";
import express from "express";
import { generateKeyPair, SignJWT } from "jose";
import { ServerCallContext } from "@a2a-js/sdk/server";
import {
  LettaTurnCancelledError,
  type LettaTurnRequest,
  type LettaTurnRunner,
} from "letta-a2a-bridge";
import { createServiceBinding } from "../services/bridge/src/service-binding.js";

const keys = await generateKeyPair("RS256");
async function fixture(runner?: LettaTurnRunner) {
  const requests: LettaTurnRequest[] = [];
  const callbacks: unknown[] = [];
  const runtime = runner ?? {
    async runTurn(request: LettaTurnRequest) {
      requests.push(request);
      request.onAssistantText("answer");
      return { text: "answer" };
    },
  };
  const make = (key: string) =>
    createServiceBinding({
      definition: {
        key,
        displayName: `Agent ${key}`,
        appServerUrl: "ws://unused",
        appServerToken: "private",
        publicBaseUrl: "https://bridge.example",
      },
      runtime,
      auth: {
        issuer: "https://issuer.test",
        audience: "test",
        jwksUrl: "https://unused/jwks",
        maximumHops: 2,
        keyResolver: async () => keys.publicKey,
      },
      oauth: {
        tokenUrl: "https://issuer.test/token",
        metadataUrl: "https://issuer.test/metadata",
        availableScopes: { "a2a.invoke": "Invoke" },
        requiredScopes: ["a2a.invoke"],
      },
      push: {
        callbacks: [
          { url: "https://callback.test/events", bearerToken: "secret" },
        ],
        fetchImpl: async (_url, init) => {
          callbacks.push(JSON.parse(init!.body as string));
          return new Response("", { status: 200 });
        },
      },
      shutdownTimeoutMs: 50,
    });
  const bindings = [make("alpha"), make("beta")];
  const app = express();
  for (const binding of bindings) app.use(binding.mountPath, binding.router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const jwt = (claims = {}) =>
    new SignJWT({
      scope: "a2a.discover a2a.invoke",
      role: "operator",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://issuer.test")
      .setAudience("test")
      .setSubject("subject")
      .setExpirationTime("1m")
      .setNotBefore(0)
      .sign(keys.privateKey);
  const token = await jwt();
  return {
    bindings,
    requests,
    callbacks,
    jwt,
    token,
    get: (path: string, bearer = token) =>
      fetch(base + path, { headers: { Authorization: `Bearer ${bearer}` } }),
    rpc: (
      method: string,
      params: unknown,
      bearer = token,
      key = "alpha",
      headers = {},
    ) =>
      fetch(`${base}/agents/${key}/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "A2A-Version": "1.0",
          Authorization: `Bearer ${bearer}`,
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    close: async () => {
      await Promise.all(bindings.map((b) => b.close()));
      server.closeAllConnections();
      server.close();
    },
  };
}
const send = (text = "hello", extra = {}) => ({
  message: {
    messageId: crypto.randomUUID(),
    role: "ROLE_USER",
    parts: [{ text }],
  },
  ...extra,
});

test("app-owned cards mount independently, remain private, and direct unverified access fails", async () => {
  const f = await fixture();
  try {
    for (const key of ["alpha", "beta"]) {
      const response = await f.get(
        `/agents/${key}/.well-known/agent-card.json`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const card = await response.json();
      expect(card.name).toBe(`Agent ${key}`);
      expect(card.supportedInterfaces[0].url).toBe(
        `https://bridge.example/agents/${key}/`,
      );
      expect(card.capabilities).toMatchObject({
        streaming: true,
        pushNotifications: true,
      });
    }
    expect(
      (await f.get("/agents/alpha/.well-known/agent-card.json", "forged"))
        .status,
    ).toBe(401);
    await expect(
      f.bindings[0]!.bridge.requestHandler.getAgentCard(
        new ServerCallContext(),
      ),
    ).rejects.toThrow("Authentication required");
    const result = await (await f.rpc("SendMessage", send())).json();
    expect(result.error).toBeUndefined();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]!.caller).toMatchObject({
      subject: "subject",
      delegation: { hop: 0, allowDelegation: false },
    });
    const id = result.result.task.id;
    expect(
      (await (await f.rpc("GetTask", { id }, f.token, "beta")).json()).error,
    ).toBeDefined();
  } finally {
    await f.close();
  }
});

test("legacy verified delegate metadata reaches runner; spoofing and synchronous delegation never execute", async () => {
  const f = await fixture();
  try {
    const agent = await f.jwt({ role: "agent" });
    const legacy = {
      message: {
        messageId: crypto.randomUUID(),
        role: "user",
        parts: [{ kind: "text", text: "a2a_invoke" }],
      },
      metadata: { lettaA2aLab: { hop: 1 } },
      configuration: { blocking: false },
    };
    const result = await (await f.rpc("message/send", legacy, agent)).json();
    expect(result.error).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.requests[0]!.caller?.delegation).toEqual({
      hop: 1,
      allowDelegation: true,
    });
    for (const [params, bearer, headers] of [
      [send("a2a_invoke"), f.token, {}],
      [send(), agent, {}],
      [send(), f.token, { "x-letta-a2a-hop": "1" }],
      [send("hello", { metadata: { lettaA2aLab: { hop: 0 } } }), agent, {}],
    ] as const)
      expect(
        (
          await (
            await f.rpc("SendMessage", params, bearer, "alpha", headers)
          ).json()
        ).error,
      ).toBeDefined();
    expect(f.requests).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("official streaming and push are wired through the binding and redact callback credentials", async () => {
  const f = await fixture();
  try {
    const response = await f.rpc(
      "SendStreamingMessage",
      send("hello", {
        configuration: {
          taskPushNotificationConfig: {
            url: "https://callback.test/events",
            authentication: { scheme: "Bearer", credentials: "secret" },
          },
        },
      }),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const stream = await response.text();
    expect(stream).toContain("answer");
    expect(stream).not.toContain("secret");
    expect(f.requests).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.callbacks.length).toBeGreaterThan(0);
  } finally {
    await f.close();
  }
});

test("official cancellation aborts the bound runner and bounded close reports completion", async () => {
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  let aborted = false;
  const f = await fixture({
    runTurn(request) {
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new LettaTurnCancelledError());
          },
          { once: true },
        );
        started();
      });
    },
  });
  try {
    const result = await (
      await f.rpc(
        "SendMessage",
        send("wait", { configuration: { returnImmediately: true } }),
      )
    ).json();
    await active;
    const canceled = await (
      await f.rpc("CancelTask", { id: result.result.task.id })
    ).json();
    expect(canceled.error).toBeUndefined();
    expect(aborted).toBe(true);
    expect((await f.bindings[0]!.close()).complete).toBe(true);
  } finally {
    await f.close();
  }
});
