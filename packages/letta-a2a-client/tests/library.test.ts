import { describe, expect, test } from "bun:test";
import { createA2AClient } from "../src/index.js";

describe("client library composition", () => {
  test("constructs a named-route client without network or filesystem setup", () => {
    const client = createA2AClient({ routes: { peer: "http://127.0.0.1:1" } });
    expect(client.targets()).toEqual(["peer"]);
    client.close();
  });

  test("rejects invalid routes and deadline options at composition", () => {
    expect(() =>
      createA2AClient({ routes: { peer: "file:///tmp/peer" } }),
    ).toThrow();
    expect(() =>
      createA2AClient({
        routes: { peer: "http://user:password@example.test" },
      }),
    ).toThrow();
    expect(() =>
      createA2AClient({
        routes: { peer: "http://example.test" },
        timeoutMs: 0,
      }),
    ).toThrow();
    expect(() =>
      createA2AClient({
        routes: { peer: "http://example.test" },
        pollIntervalMs: NaN,
      }),
    ).toThrow();
  });

  test("closed clients reject new work before connecting", async () => {
    const client = createA2AClient({ routes: { peer: "http://127.0.0.1:1" } });
    client.close();
    await expect(
      client.invoke({
        target: "peer",
        message: "must not send",
        localScope: "agent/conversation",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
  });
});
