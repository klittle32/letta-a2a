import { expect, test } from "bun:test";
import express from "express";
import {
  createBridge,
  createBridgeRouter,
  listenLoopback,
} from "../src/index.js";

test("custom mounts reuse guarded discovery and SDK negotiation without unscoped discovery", async () => {
  let discovers = 0;
  const user = { isAuthenticated: true, userName: "verified" };
  const bridge = createBridge({
    sharingDomain: "router",
    publicBaseUrl: "https://bridge.test",
    runner: {
      async runTurn() {
        return { text: "done" };
      },
    },
    transport: { userBuilder: async () => user },
    auth: {
      projectCaller: (context) =>
        context.user === user
          ? { issuer: "issuer", subject: "subject", tenant: "" }
          : undefined,
      authorize: ({ operation }) => {
        if (operation === "discover") discovers++;
        return true;
      },
    },
  });
  const app = express();
  app.use("/agents/custom", createBridgeRouter(bridge));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/agents/custom`;
  try {
    const discovery = await fetch(`${url}/.well-known/agent-card.json`);
    expect(discovery.status).toBe(200);
    expect(discovery.headers.get("cache-control")).toBe("private, no-store");
    expect(discovers).toBe(1);
    const response = await fetch(`${url}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "SendMessage",
        params: {
          message: {
            messageId: "one",
            role: "ROLE_USER",
            parts: [{ text: "hello" }],
          },
        },
      }),
    });
    expect(await response.json()).not.toHaveProperty("error");
    expect(discovers).toBe(1);
    await expect(bridge.requestHandler.getAgentCard()).rejects.toThrow(
      "Authentication required",
    );
  } finally {
    await bridge.close();
    server.closeAllConnections();
    server.close();
  }
});

test("router and loopback listener both reject authenticated bridges without a transport", async () => {
  const bridge = createBridge({
    sharingDomain: "test",
    publicBaseUrl: "https://bridge.test",
    runner: {
      async runTurn() {
        return { text: "done" };
      },
    },
    auth: { projectCaller: () => undefined, authorize: () => false },
  });
  try {
    expect(() => createBridgeRouter(bridge)).toThrow("trusted transport");
    await expect(listenLoopback(bridge)).rejects.toThrow("trusted transport");
  } finally {
    await bridge.close();
  }
});
