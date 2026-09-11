import {
  A2A_PROTOCOL_VERSION,
  AgentCard as AgentCardMessage,
  type AgentCard,
} from "@a2a-js/sdk";

import type { AgentDefinition } from "./config.js";

export interface OAuthCardConfig {
  tokenUrl: string;
  metadataUrl: string;
  availableScopes: Record<string, string>;
  requiredScopes: string[];
}

interface TextPartLike {
  text?: unknown;
  content?: {
    $case?: unknown;
    value?: unknown;
  };
}

export function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part: TextPartLike) => {
      if (typeof part?.text === "string") return part.text;
      if (
        part?.content?.$case === "text" &&
        typeof part.content.value === "string"
      ) {
        return part.content.value;
      }
      return "";
    })
    .join("");
}

export interface A2AInvocationResult {
  contextId?: string;
  taskId?: string;
  text: string;
}

export function createAgentCard(
  definition: AgentDefinition & { publicBaseUrl: string },
  oauth: OAuthCardConfig,
): AgentCard {
  const baseUrl = definition.publicBaseUrl.replace(/\/$/, "");
  const invocationUrl = `${baseUrl}/agents/${definition.key}/`;

  return {
    name: definition.displayName,
    description: `${definition.displayName}, a persistent Letta agent exposed through the A2A lab bridge.`,
    supportedInterfaces: [
      {
        url: invocationUrl,
        protocolBinding: "JSONRPC",
        tenant: "",
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
      {
        url: invocationUrl,
        protocolBinding: "JSONRPC",
        tenant: "",
        protocolVersion: "0.3",
      },
    ],
    provider: {
      organization: "Letta A2A Lab",
      url: baseUrl,
    },
    version: "0.1.0",
    capabilities: {
      streaming: true,
      pushNotifications: true,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {
      a2aOAuth: {
        scheme: {
          $case: "oauth2SecurityScheme",
          value: {
            description:
              "OAuth 2.0 client credentials verified by the bridge and agentgateway.",
            flows: {
              flow: {
                $case: "clientCredentials",
                value: {
                  tokenUrl: oauth.tokenUrl,
                  refreshUrl: "",
                  scopes: oauth.availableScopes,
                },
              },
            },
            oauth2MetadataUrl: oauth.metadataUrl,
          },
        },
      },
    },
    securityRequirements: [
      {
        schemes: {
          a2aOAuth: { list: oauth.requiredScopes },
        },
      },
    ],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "general-assistance",
        name: "General assistance",
        description:
          "Handle a delegated text task using persistent Letta context.",
        tags: ["letta", "delegation", "testing"],
        examples: [
          "Summarize this request",
          "Ask the other lab agent for help",
        ],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
    ],
    documentationUrl: "",
    signatures: [],
  };
}

export function serializeAgentCard(card: AgentCard): unknown {
  return AgentCardMessage.toJSON(card);
}
