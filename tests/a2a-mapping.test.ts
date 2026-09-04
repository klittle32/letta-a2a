import { describe, expect, test } from "bun:test";

import {
  createAgentCard,
  extractA2AResponse,
  extractMessageText,
  extractLettaAssistantText,
  serializeAgentCard,
} from "../services/bridge/src/mapping.js";

describe("A2A and Letta mapping", () => {
  test("extracts all text parts from an A2A protobuf JSON message", () => {
    expect(
      extractMessageText({
        parts: [{ text: "hello " }, { data: { ignored: true } }, { text: "world" }],
      }),
    ).toBe("hello world");
  });

  test("extracts assistant text from Letta string and content parts", () => {
    expect(
      extractLettaAssistantText({
        type: "message",
        message_type: "assistant_message",
        content: "hello",
      }),
    ).toBe("hello");

    expect(
      extractLettaAssistantText({
        type: "message",
        message_type: "assistant_message",
        content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }],
      }),
    ).toBe("hello world");
  });

  test("extracts direct messages and task artifacts from A2A responses", () => {
    expect(
      extractA2AResponse({
        result: {
          message: {
            contextId: "ctx-1",
            parts: [{ text: "direct" }],
          },
        },
      }),
    ).toEqual({ contextId: "ctx-1", taskId: undefined, text: "direct" });

    expect(
      extractA2AResponse({
        result: {
          task: {
            id: "task-1",
            contextId: "ctx-2",
            artifacts: [{ parts: [{ text: "artifact" }] }],
          },
        },
      }),
    ).toEqual({ contextId: "ctx-2", taskId: "task-1", text: "artifact" });
  });

  test("creates a version-pinned card at the mounted agent path", () => {
    const card = createAgentCard(
      {
        key: "agent-a",
        displayName: "Agent A",
        appServerUrl: "ws://agent-a:4500",
        appServerToken: "token-a",
        publicBaseUrl: "http://bridge:8080",
      },
      {
        tokenUrl: "http://127.0.0.1:9000/token",
        metadataUrl:
          "http://127.0.0.1:9000/.well-known/oauth-authorization-server",
        availableScopes: {
          "a2a.discover": "Discover an A2A agent through the lab gateway.",
          "a2a.invoke": "Invoke an A2A agent through the lab gateway.",
        },
        requiredScopes: ["a2a.invoke"],
      },
    );

    expect(card.supportedInterfaces[0]?.url).toBe(
      "http://bridge:8080/agents/agent-a/",
    );
    expect(card.supportedInterfaces[0]?.protocolVersion).toBe("1.0");
    expect(card.supportedInterfaces[1]?.protocolVersion).toBe("0.3");
    expect(card.capabilities?.streaming).toBe(false);
    expect(card.securitySchemes).toEqual({
      a2aOAuth: {
        scheme: {
          $case: "oauth2SecurityScheme",
          value: {
            description:
              "OAuth 2.0 client credentials enforced by agentgateway.",
            flows: {
              flow: {
                $case: "clientCredentials",
                value: {
                  tokenUrl: "http://127.0.0.1:9000/token",
                  refreshUrl: "",
                  scopes: {
                    "a2a.discover":
                      "Discover an A2A agent through the lab gateway.",
                    "a2a.invoke": "Invoke an A2A agent through the lab gateway.",
                  },
                },
              },
            },
            oauth2MetadataUrl:
              "http://127.0.0.1:9000/.well-known/oauth-authorization-server",
          },
        },
      },
    });
    expect(card.securityRequirements).toEqual([
      { schemes: { a2aOAuth: { list: ["a2a.invoke"] } } },
    ]);
    expect(serializeAgentCard(card)).toMatchObject({
      securitySchemes: {
        a2aOAuth: {
          oauth2SecurityScheme: {
            oauth2MetadataUrl:
              "http://127.0.0.1:9000/.well-known/oauth-authorization-server",
            flows: {
              clientCredentials: {
                tokenUrl: "http://127.0.0.1:9000/token",
                scopes: {
                  "a2a.discover":
                    "Discover an A2A agent through the lab gateway.",
                  "a2a.invoke": "Invoke an A2A agent through the lab gateway.",
                },
              },
            },
          },
        },
      },
      securityRequirements: [
        { schemes: { a2aOAuth: { list: ["a2a.invoke"] } } },
      ],
    });
  });
});
