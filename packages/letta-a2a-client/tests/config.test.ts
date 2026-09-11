import { describe, expect, test } from "bun:test";

import { parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  test("normalizes named HTTP routes and applies defaults", () => {
    expect(
      parseConfig(
        {
          routes: {
            local: "http://127.0.0.1:41241/",
            peer: "https://peer.example.test/a2a/agent-b",
          },
        },
        "/home/tester",
      ),
    ).toEqual({
      routes: {
        local: "http://127.0.0.1:41241",
        peer: "https://peer.example.test/a2a/agent-b",
      },
      pollIntervalMs: 500,
      timeoutMs: 120_000,
      contextStorePath: "/home/tester/.letta/a2a-client-contexts.json",
    });
  });

  test("rejects embedded credentials and unsupported protocols", () => {
    expect(() =>
      parseConfig(
        { routes: { peer: "https://user:secret@example.test" } },
        "/home/tester",
      ),
    ).toThrow("must not contain credentials");

    expect(() =>
      parseConfig(
        { routes: { peer: "file:///tmp/agent" } },
        "/home/tester",
      ),
    ).toThrow("must use http or https");
  });

  test("requires at least one valid route", () => {
    expect(() => parseConfig({ routes: {} }, "/home/tester")).toThrow(
      "at least one route",
    );
  });
});
