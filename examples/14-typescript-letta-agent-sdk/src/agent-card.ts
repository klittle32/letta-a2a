import {
  A2A_PROTOCOL_VERSION,
  type AgentCard,
} from "@a2a-js/sdk";

export function createAgentCard(publicBaseUrl: string): AgentCard {
  return {
    name: "Letta Agent SDK Example",
    description:
      "A persistent Letta agent exposed through the official TypeScript A2A SDK.",
    supportedInterfaces: [
      {
        url: `${publicBaseUrl}/`,
        protocolBinding: "JSONRPC",
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: "",
      },
    ],
    provider: {
      organization: "Letta A2A Lab",
      url: publicBaseUrl,
    },
    version: "1.0.0",
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "general-assistance",
        name: "General assistance",
        description:
          "Answer text requests while preserving conversation context in Letta.",
        tags: ["letta", "typescript", "a2a"],
        examples: [
          "Remember the codeword ORCHID.",
          "What codeword did I ask you to remember?",
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
