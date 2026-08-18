import {
  createAppServerClient,
  type AppServerClient,
} from "@letta-ai/letta-code/app-server-client";
import WebSocket from "ws";

import type { AgentDefinition, GatewayUrls } from "./config.js";
import { ContextStore } from "./context-store.js";
import { extractLettaAssistantText } from "./mapping.js";
import {
  A2A_EXTERNAL_TOOL,
  invokeA2A,
} from "./a2a-client.js";
import { shouldExposeDelegationTool } from "./delegation-policy.js";

interface ActiveTurn {
  runtime: RuntimeScope;
  cancelled: boolean;
  hop: number;
}

interface RuntimeScope {
  agent_id: string;
  conversation_id: string;
}

export class LettaTurnCancelledError extends Error {
  constructor() {
    super("Letta turn was cancelled");
    this.name = "LettaTurnCancelledError";
  }
}

export class LettaRuntime {
  private client?: AppServerClient;
  private agentId?: string;
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly conversationTails = new Map<string, Promise<void>>();

  constructor(
    readonly definition: AgentDefinition,
    private readonly contextStore: ContextStore,
    private readonly model: string,
    private readonly turnTimeoutMs: number,
    private readonly a2aGatewayUrls: GatewayUrls,
    private readonly a2aGatewayKey: string,
    private readonly maximumA2AHops: number,
  ) {}

  async connect(): Promise<void> {
    const client = createAppServerClient({
      url: this.definition.appServerUrl,
      authToken: this.definition.appServerToken,
      WebSocket: WebSocket as never,
      requestTimeoutMs: 30_000,
    });
    await client.connect();
    this.client = client;
    client.onMessage((message) => {
      if (message.type.includes("tool")) {
        console.log(`[${this.definition.key}] app-server event ${message.type}`);
      }
    });
    client.onExternalToolCall(async (request) => {
      if (request.tool_name !== A2A_EXTERNAL_TOOL.name) {
        return {
          content: [{ type: "text", text: `Unknown external tool: ${request.tool_name}` }],
          is_error: true,
        };
      }

      try {
        const activeTurn = [...this.activeTurns.values()].find((turn) =>
          sameRuntime(turn.runtime, request.runtime),
        );
        const target = String(request.input.target ?? "");
        const gatewayUrl = this.a2aGatewayUrls[target];
        if (!gatewayUrl) throw new Error(`No A2A gateway route for ${target}`);
        console.log(
          `[${this.definition.key}] invoking ${target} through ${gatewayUrl}`,
        );
        const result = await invokeA2A(
          {
            target,
            message: String(request.input.message ?? ""),
            context_id:
              typeof request.input.context_id === "string"
                ? request.input.context_id
                : undefined,
            hop: (activeTurn?.hop ?? 0) + 1,
          },
          { gatewayUrl, gatewayKey: this.a2aGatewayKey },
        );
        console.log(`[${this.definition.key}] received A2A result from ${target}`);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      } catch (error) {
        console.error(
          `[${this.definition.key}] A2A invocation failed:`,
          error,
        );
        return {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          is_error: true,
        };
      }
    });
    this.agentId = await this.resolveOrCreateAgent();
  }

  close(): void {
    this.client?.close();
  }

  async runTurn(options: {
    a2aContextId: string;
    a2aTaskId: string;
    messageId: string;
    text: string;
    hop: number;
  }): Promise<string> {
    return this.withConversationLock(options.a2aContextId, () =>
      this.runTurnUnlocked(options),
    );
  }

  async cancelTask(taskId: string): Promise<void> {
    const active = this.activeTurns.get(taskId);
    if (!active || !this.client) return;
    active.cancelled = true;
    await this.client.abort({ runtime: active.runtime });
  }

  private async runTurnUnlocked(options: {
    a2aContextId: string;
    a2aTaskId: string;
    messageId: string;
    text: string;
    hop: number;
  }): Promise<string> {
    const client = this.requiredClient();
    const agentId = this.requiredAgentId();
    const existingConversationId = this.contextStore.get(
      this.definition.key,
      options.a2aContextId,
    );

    const exposeDelegationTool = shouldExposeDelegationTool(
      options.text,
      options.hop,
      this.maximumA2AHops,
    );
    const started = await client.runtimeStart({
      agent_id: agentId,
      ...(existingConversationId
        ? { conversation_id: existingConversationId }
        : { create_conversation: { body: {} } }),
      cwd: "/workspace",
      // The controller exposes at most one scoped external tool on this
      // isolated runtime, so no human approval round-trip is available here.
      mode: "unrestricted",
      client_info: {
        name: "letta-a2a-bridge",
        title: "Letta A2A Bridge",
        version: "0.1.0",
      },
      recover_approvals: false,
      force_device_status: false,
      external_tools: [
        { scope_id: "a2a-lab-delegation", tools: [A2A_EXTERNAL_TOOL] },
      ],
    });

    if (!started.success || !started.runtime) {
      throw new Error(started.error ?? "failed to start Letta runtime");
    }
    const runtime = started.runtime;

    const active: ActiveTurn = { runtime, cancelled: false, hop: options.hop };
    this.activeTurns.set(options.a2aTaskId, active);

    try {
      return await new Promise<string>((resolve, reject) => {
        let assistantText = "";
        let settled = false;

        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          disposeMessageHandler();
          callback();
        };

        const disposeMessageHandler = client.onMessage((message) => {
          if (!belongsToRuntime(message, runtime)) return;

          if (message.type === "stream_delta") {
            assistantText += extractLettaAssistantText(message.delta);
            if (
              "message_type" in message.delta &&
              message.delta.message_type === "loop_error" &&
              message.delta.is_terminal
            ) {
              finish(() => reject(new Error(message.delta.message)));
            }
            return;
          }

          if (message.type === "turn_finished") {
            if (active.cancelled) {
              finish(() => reject(new LettaTurnCancelledError()));
            } else if (message.error) {
              finish(() => reject(new Error(message.error)));
            } else {
              finish(() => resolve(assistantText.trim()));
            }
          }
        });

        const timeout = setTimeout(() => {
          active.cancelled = true;
          void client.abort({ runtime }).catch(() => undefined);
          finish(() =>
            reject(
              new Error(
                `Letta turn exceeded ${Math.round(this.turnTimeoutMs / 1000)} seconds`,
              ),
            ),
          );
        }, this.turnTimeoutMs);

        void client
          .submitInput({
            runtime,
            payload: {
              kind: "create_message",
              messages: [
                {
                  role: "user",
                  content: options.text,
                  client_message_id: options.messageId,
                },
              ],
              client_tool_allowlist: exposeDelegationTool
                ? [A2A_EXTERNAL_TOOL.name]
                : [],
              external_tool_scope_ids: exposeDelegationTool
                ? ["a2a-lab-delegation"]
                : [],
              exclude_interactive_tools: true,
            },
          })
          .then((accepted) => {
            if (!accepted.accepted) {
              finish(() =>
                reject(new Error(accepted.error ?? "Letta rejected the input")),
              );
              return;
            }
            if (!existingConversationId) {
              this.contextStore.save(
                this.definition.key,
                options.a2aContextId,
                runtime.conversation_id,
              );
            }
          })
          .catch((error) => finish(() => reject(error)));
      });
    } finally {
      this.activeTurns.delete(options.a2aTaskId);
    }
  }

  private async resolveOrCreateAgent(): Promise<string> {
    const client = this.requiredClient();
    const requestId = client.nextRequestId("agent-list");
    const listed = await client.requestRaw<AgentListResponse>(
      { type: "agent_list", request_id: requestId },
      {
        predicate: (message): message is AgentListResponse =>
          isRecord(message) &&
          message.type === "agent_list_response" &&
          message.request_id === requestId,
      },
    );

    if (!listed.success) {
      throw new Error(listed.error ?? "failed to list Letta agents");
    }
    const existing = listed.agents.find(
      (agent) => agent.name === this.definition.displayName,
    );
    if (existing) return existing.id;

    const started = await client.runtimeStart({
      create_agent: {
        body: {
          name: this.definition.displayName,
          description: `${this.definition.displayName} in the isolated bidirectional A2A lab.`,
          model: this.model,
          include_base_tools: false,
          memory_blocks: [
            {
              label: "persona",
              value: `You are ${this.definition.displayName} in an isolated A2A interoperability lab. Be concise. When explicitly asked to consult the other lab agent, use a2a_invoke and report the result.`,
            },
          ],
        },
        pin_global: true,
        memfs: false,
      },
      create_conversation: { body: {} },
      cwd: "/workspace",
      mode: "standard",
      recover_approvals: false,
      force_device_status: false,
      external_tools: [
        { scope_id: "a2a-lab-delegation", tools: [A2A_EXTERNAL_TOOL] },
      ],
      client_info: {
        name: "letta-a2a-bridge",
        title: "Letta A2A Bridge Bootstrap",
        version: "0.1.0",
      },
    });

    if (!started.success || !started.runtime) {
      throw new Error(started.error ?? "failed to create Letta agent");
    }
    return started.runtime.agent_id;
  }

  private requiredClient(): AppServerClient {
    if (!this.client) throw new Error("Letta App Server client is not connected");
    return this.client;
  }

  private requiredAgentId(): string {
    if (!this.agentId) throw new Error("Letta agent is not initialized");
    return this.agentId;
  }

  private async withConversationLock<T>(
    contextId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const prior = this.conversationTails.get(contextId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queuedTail = prior.then(() => tail);
    this.conversationTails.set(contextId, queuedTail);
    await prior;
    try {
      return await work();
    } finally {
      release();
      if (this.conversationTails.get(contextId) === queuedTail) {
        this.conversationTails.delete(contextId);
      }
    }
  }
}

type AgentListResponse = Record<string, unknown> & {
  type: "agent_list_response";
  request_id: string;
  success: boolean;
  agents: Array<{ id: string; name?: string | null }>;
  error?: string;
};

function belongsToRuntime(
  message: any,
  runtime: RuntimeScope,
): boolean {
  if (!("runtime" in message) || !message.runtime) return false;
  return (
    message.runtime.agent_id === runtime.agent_id &&
    message.runtime.conversation_id === runtime.conversation_id
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object";
}

function sameRuntime(
  left: RuntimeScope,
  right: RuntimeScope | undefined,
): boolean {
  return Boolean(
    right &&
      left.agent_id === right.agent_id &&
      left.conversation_id === right.conversation_id,
  );
}
