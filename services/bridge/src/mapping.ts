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

export function extractLettaAssistantText(delta: unknown): string {
  if (!delta || typeof delta !== "object") return "";
  const record = delta as Record<string, unknown>;
  if (
    record.type !== "message" ||
    record.message_type !== "assistant_message"
  ) {
    return "";
  }

  if (typeof record.content === "string") return record.content;
  if (!Array.isArray(record.content)) return "";

  return record.content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const contentPart = part as Record<string, unknown>;
      return typeof contentPart.text === "string" ? contentPart.text : "";
    })
    .join("");
}

export interface A2AInvocationResult {
  contextId?: string;
  taskId?: string;
  text: string;
}

export function extractA2AResponse(payload: unknown): A2AInvocationResult {
  if (!payload || typeof payload !== "object") {
    throw new Error("A2A response was not an object");
  }

  const envelope = payload as Record<string, unknown>;
  if (envelope.error && typeof envelope.error === "object") {
    const error = envelope.error as Record<string, unknown>;
    throw new Error(
      `A2A error ${String(error.code ?? "unknown")}: ${String(error.message ?? "unknown error")}`,
    );
  }

  const result = envelope.result;
  if (!result || typeof result !== "object") {
    throw new Error("A2A response did not contain a result");
  }

  const resultRecord = result as Record<string, unknown>;
  const message = asRecord(resultRecord.message ?? resultRecord.msg);
  if (message) {
    return {
      contextId: optionalString(message.contextId),
      taskId: optionalString(message.taskId),
      text: extractMessageText(message),
    };
  }

  const task = asRecord(resultRecord.task);
  if (task) {
    const artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
    const text = artifacts
      .map((artifact) => extractMessageText(asRecord(artifact)))
      .join("");
    return {
      contextId: optionalString(task.contextId),
      taskId: optionalString(task.id),
      text,
    };
  }

  throw new Error("A2A result contained neither a message nor a task");
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
      streaming: false,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {
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
        description: "Handle a delegated text task using persistent Letta context.",
        tags: ["letta", "delegation", "testing"],
        examples: ["Summarize this request", "Ask the other lab agent for help"],
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
