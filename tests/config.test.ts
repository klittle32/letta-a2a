import { describe, expect, test } from "bun:test";

import {
  loadAgentDefinitions,
  loadGatewayUrls,
} from "../services/bridge/src/config.js";

describe("loadAgentDefinitions", () => {
  test("loads two distinct Letta runtimes", () => {
    const agents = loadAgentDefinitions(
      JSON.stringify([
        {
          key: "agent-a",
          displayName: "Agent A",
          appServerUrl: "ws://agent-a:4500",
          appServerToken: "token-a",
        },
        {
          key: "agent-b",
          displayName: "Agent B",
          appServerUrl: "ws://agent-b:4500",
          appServerToken: "token-b",
        },
      ]),
    );

    expect(agents.map((agent) => agent.key)).toEqual(["agent-a", "agent-b"]);
  });

  test("rejects duplicate public agent keys", () => {
    expect(() =>
      loadAgentDefinitions(
        JSON.stringify([
          {
            key: "agent-a",
            displayName: "Agent A",
            appServerUrl: "ws://agent-a:4500",
            appServerToken: "token-a",
          },
          {
            key: "agent-a",
            displayName: "Agent B",
            appServerUrl: "ws://agent-b:4500",
            appServerToken: "token-b",
          },
        ]),
      ),
    ).toThrow("duplicate agent key");
  });

  test("rejects duplicate Letta display names", () => {
    expect(() =>
      loadAgentDefinitions(
        JSON.stringify([
          {
            key: "agent-a",
            displayName: "Same Agent",
            appServerUrl: "ws://a/ws",
            appServerToken: "token",
          },
          {
            key: "agent-b",
            displayName: "Same Agent",
            appServerUrl: "ws://b/ws",
            appServerToken: "token",
          },
        ]),
      ),
    ).toThrow("duplicate agent display name");
  });

  test("requires one outbound gateway route per public agent", () => {
    const definitions = loadAgentDefinitions(
      JSON.stringify([
        {
          key: "agent-a",
          displayName: "Agent A",
          appServerUrl: "ws://a/ws",
          appServerToken: "token",
        },
        {
          key: "agent-b",
          displayName: "Agent B",
          appServerUrl: "ws://b/ws",
          appServerToken: "token",
        },
      ]),
    );
    expect(
      loadGatewayUrls(
        JSON.stringify({
          "agent-a": "http://gateway:4000",
          "agent-b": "http://gateway:4000/",
        }),
        definitions,
      ),
    ).toEqual({
      "agent-a": "http://gateway:4000",
      "agent-b": "http://gateway:4000",
    });
    expect(() =>
      loadGatewayUrls(
        JSON.stringify({ "agent-a": "http://gateway:4000" }),
        definitions,
      ),
    ).toThrow("agent-b");
  });

  test("preserves valid outbound-only A2A gateway routes", () => {
    const definitions = loadAgentDefinitions(
      JSON.stringify([
        {
          key: "agent-a",
          displayName: "Agent A",
          appServerUrl: "ws://a/ws",
          appServerToken: "token",
        },
      ]),
    );

    expect(
      loadGatewayUrls(
        JSON.stringify({
          "agent-a": "http://gateway:4000",
          "reference-agent": "http://gateway:4000",
        }),
        definitions,
      ),
    ).toEqual({
      "agent-a": "http://gateway:4000",
      "reference-agent": "http://gateway:4000",
    });
  });

  test("rejects gateway URLs that could leak the shared credential", () => {
    const definitions = loadAgentDefinitions(
      JSON.stringify([
        {
          key: "agent-a",
          displayName: "Agent A",
          appServerUrl: "ws://a/ws",
          appServerToken: "token",
        },
      ]),
    );

    expect(() =>
      loadGatewayUrls(
        JSON.stringify({ "agent-a": "http://user:secret@gateway:4000" }),
        definitions,
      ),
    ).toThrow("credentials");
    expect(() =>
      loadGatewayUrls(
        JSON.stringify({ "agent-a": "http://gateway:4000?redirect=elsewhere" }),
        definitions,
      ),
    ).toThrow("query");
  });
});
