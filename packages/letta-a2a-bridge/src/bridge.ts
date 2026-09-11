import express from "express";
import {
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_PATH,
  type AgentCard,
  type SendMessageRequest,
} from "@a2a-js/sdk";
import { UnsupportedOperationError } from "@a2a-js/sdk/errors";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  type ServerCallContext,
  type TaskStore,
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import type { LettaAgentClient } from "@letta-ai/letta-agent-sdk";
import {
  AgentSdkTurnRunner,
  type LettaTurnRunner,
  type SessionPolicy,
} from "./letta-agent.js";
import { LettaAgentExecutor } from "./letta-agent-executor.js";

interface BridgeOptions {
  /** Anonymous local profile: every caller belongs to this one sharing domain. */
  sharingDomain: string;
  publicBaseUrl: string;
  name?: string;
  taskStore?: TaskStore;
  shutdownTimeoutMs?: number;
}
export type CreateBridgeOptions = BridgeOptions &
  (
    | {
        runner: LettaTurnRunner;
        client?: never;
        agentId?: never;
        sessionOptions?: never;
      }
    | {
        runner?: never;
        client: LettaAgentClient;
        agentId: string;
        sessionOptions: SessionPolicy["sessionOptions"];
      }
  );

/** No agents, sockets, hooks or global mods are created by importing this module. */
export function createBridge(options: CreateBridgeOptions) {
  assertLoopbackUrl(options.publicBaseUrl);
  if (!options.sharingDomain.trim())
    throw new Error("An explicit sharing domain is required");
  const runner =
    options.runner ??
    new AgentSdkTurnRunner(options.client!, options.agentId!, {
      sharingDomain: options.sharingDomain,
      sessionOptions: options.sessionOptions!,
    });
  const executor = new LettaAgentExecutor(runner, options.shutdownTimeoutMs);
  const card = createAgentCard(options.publicBaseUrl, options.name);
  // Preserve the official store and ServerCallContext seam. No parallel task model.
  const taskStore = options.taskStore ?? new InMemoryTaskStore();
  const requestHandler = new NewTaskRequestHandler(card, taskStore, executor);
  return { card, executor, requestHandler, close: () => executor.close() };
}
export type Bridge = ReturnType<typeof createBridge>;

/** This extraction supports new tasks in continued contexts, not task updates. */
class NewTaskRequestHandler extends DefaultRequestHandler {
  override async sendMessage(
    request: SendMessageRequest,
    context: ServerCallContext,
  ) {
    assertNewTask(request);
    return super.sendMessage(request, context);
  }

  override async *sendMessageStream(
    request: SendMessageRequest,
    context: ServerCallContext,
  ) {
    assertNewTask(request);
    yield* super.sendMessageStream(request, context);
  }
}

function assertNewTask(request: SendMessageRequest): void {
  if (request.message?.taskId) {
    throw new UnsupportedOperationError(
      "Same-task continuation is not supported by this bridge profile",
    );
  }
}

/** The convenience listener intentionally offers no non-loopback host option. */
export async function listenLoopback(
  bridge: Bridge,
  options: { port?: number } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: bridge.requestHandler }),
  );
  app.use(
    "/",
    jsonRpcHandler({
      requestHandler: bridge.requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );
  const server = app.listen(options.port ?? 0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected TCP listener");
  const url = `http://127.0.0.1:${address.port}`;
  bridge.card.supportedInterfaces[0]!.url = `${url}/`;
  let closing: ReturnType<Bridge["close"]> | undefined;
  return {
    url,
    close() {
      if (closing) return closing;
      // Stop accepting immediately; bound turn cleanup, then terminate HTTP streams.
      const closed = new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      closing = bridge.close().then(async (result) => {
        server.closeAllConnections();
        await closed;
        return result;
      });
      return closing;
    },
  };
}
function assertLoopbackUrl(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Anonymous bridge requires a loopback HTTP origin");
  }
}
function createAgentCard(
  baseUrl: string,
  name = "Letta Agent SDK bridge",
): AgentCard {
  return {
    name,
    description:
      "A persistent Letta agent through the official A2A and Letta Agent SDKs.",
    supportedInterfaces: [
      {
        url: `${baseUrl.replace(/\/$/, "")}/`,
        protocolBinding: "JSONRPC",
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: "",
      },
    ],
    provider: { organization: "Letta A2A", url: baseUrl },
    version: "0.1.0",
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
        id: "text-assistance",
        name: "Text assistance",
        description: "Text requests with dedicated conversation continuity.",
        tags: ["letta"],
        examples: [],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
    ],
    documentationUrl: "",
    signatures: [],
  };
}
