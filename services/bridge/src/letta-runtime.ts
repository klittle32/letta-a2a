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
  A2AInvocationCancelledError,
  invokeA2A,
} from "./a2a-client.js";
import type { AccessTokenProvider } from "./oauth-client.js";
import { shouldExposeDelegationTool } from "./delegation-policy.js";

interface ActiveTurn {
  runtime?: RuntimeScope;
  cancelled: boolean;
  hop: number;
  abortController: AbortController;
  outboundInvocations: Set<Promise<unknown>>;
}

interface RuntimeScope {
  agent_id: string;
  conversation_id: string;
}

interface TurnOptions {
  a2aContextId: string;
  a2aTaskId: string;
  messageId: string;
  text: string;
  hop: number;
  onAssistantDelta?: (text: string) => void;
}

export class LettaTurnCancelledError extends Error {
  constructor() {
    super("Letta turn was cancelled");
    this.name = "LettaTurnCancelledError";
  }
}

export type TurnTerminalOutcome = "completed" | "failed" | "canceled";

export class LettaRuntime {
  private client?: AppServerClient;
  private agentId?: string;
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly terminalClaims = new Map<string, TurnTerminalOutcome>();
  private readonly conversationTails = new Map<string, Promise<void>>();

  constructor(
    readonly definition: AgentDefinition,
    private readonly contextStore: ContextStore,
    private readonly model: string,
    private readonly turnTimeoutMs: number,
    private readonly a2aGatewayUrls: GatewayUrls,
    private readonly a2aTokenProvider: AccessTokenProvider,
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
        const activeTurn = [...this.activeTurns.values()].find(
          (turn) =>
            turn.runtime && sameRuntime(turn.runtime, request.runtime),
        );
        if (!activeTurn) {
          throw new Error("No active Letta turn owns this external tool call");
        }
        const target = String(request.input.target ?? "");
        const gatewayUrl = this.a2aGatewayUrls[target];
        if (!gatewayUrl) throw new Error(`No A2A gateway route for ${target}`);
        console.log(
          `[${this.definition.key}] invoking ${target} through ${gatewayUrl}`,
        );
        const invocation = invokeA2A(
          {
            target,
            message: String(request.input.message ?? ""),
            context_id:
              typeof request.input.context_id === "string"
                ? request.input.context_id
                : undefined,
            hop: activeTurn.hop + 1,
          },
          { gatewayUrl, tokenProvider: this.a2aTokenProvider },
          fetch,
          activeTurn.abortController.signal,
        );
        activeTurn.outboundInvocations.add(invocation);
        try {
          const result = await invocation;
          console.log(`[${this.definition.key}] received A2A result from ${target}`);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        } finally {
          activeTurn.outboundInvocations.delete(invocation);
        }
      } catch (error) {
        if (error instanceof A2AInvocationCancelledError) {
          console.log(`[${this.definition.key}] A2A invocation cancelled`);
        } else {
          console.error(
            `[${this.definition.key}] A2A invocation failed:`,
            error,
          );
        }
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
    for (const active of this.activeTurns.values()) {
      active.cancelled = true;
      active.abortController.abort();
    }
    this.client?.close();
  }

  async runTurn(options: TurnOptions): Promise<string> {
    const active: ActiveTurn = {
      cancelled: false,
      hop: options.hop,
      abortController: new AbortController(),
      outboundInvocations: new Set(),
    };
    this.activeTurns.set(options.a2aTaskId, active);
    return this.withConversationLock(
      options.a2aContextId,
      async () => {
        if (active.cancelled) throw new LettaTurnCancelledError();
        return this.runTurnUnlocked(options, active);
      },
      active.abortController.signal,
    );
  }

  async cancelTask(taskId: string): Promise<void> {
    const active = this.activeTurns.get(taskId);
    if (!active) return;
    active.cancelled = true;
    const outboundInvocations = [...active.outboundInvocations];
    active.abortController.abort();

    const pending: Promise<unknown>[] = [...outboundInvocations];
    if (active.runtime && this.client) {
      pending.push(this.client.abort({ runtime: active.runtime }));
    }
    await Promise.allSettled(pending);
  }

  claimTerminal(
    taskId: string,
    requested: TurnTerminalOutcome,
  ): TurnTerminalOutcome {
    const existing = this.terminalClaims.get(taskId);
    if (existing) return existing;

    const active = this.activeTurns.get(taskId);
    const outcome = active?.cancelled ? "canceled" : requested;
    this.terminalClaims.set(taskId, outcome);
    if (active) this.activeTurns.delete(taskId);
    return outcome;
  }

  private async runTurnUnlocked(
    options: TurnOptions,
    active: ActiveTurn,
  ): Promise<string> {
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
    let started;
    try {
      started = await client.runtimeStart({
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
    } catch (error) {
      if (active.cancelled) throw new LettaTurnCancelledError();
      throw error;
    }

    if (!started.success || !started.runtime) {
      if (active.cancelled) throw new LettaTurnCancelledError();
      throw new Error(started.error ?? "failed to start Letta runtime");
    }
    const runtime = started.runtime;
    active.runtime = runtime;

    try {
      return await new Promise<string>((resolve, reject) => {
        let assistantText = "";
        let emittedAssistantText = "";
        let settled = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let cancellationDrainTimeout:
          | ReturnType<typeof setTimeout>
          | undefined;

        const emitPublicAssistantText = (final: boolean) => {
          const normalized = final
            ? assistantText.trim()
            : assistantText.trimStart().replace(/\s+$/u, "");
          const nextChunk = normalized.slice(emittedAssistantText.length);
          if (nextChunk && !active.cancelled) {
            options.onAssistantDelta?.(nextChunk);
            emittedAssistantText = normalized;
          }
        };

        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          if (cancellationDrainTimeout) {
            clearTimeout(cancellationDrainTimeout);
          }
          active.abortController.signal.removeEventListener(
            "abort",
            beginCancellationDrain,
          );
          disposeMessageHandler();
          callback();
        };

        const beginCancellationDrain = () => {
          if (
            settled ||
            !active.cancelled ||
            cancellationDrainTimeout
          ) {
            return;
          }
          if (timeout) clearTimeout(timeout);
          cancellationDrainTimeout = setTimeout(
            () => finish(() => reject(new LettaTurnCancelledError())),
            Math.min(5_000, Math.max(100, this.turnTimeoutMs)),
          );
        };

        const disposeMessageHandler = client.onMessage((message) => {
          if (!belongsToRuntime(message, runtime)) return;

          if (message.type === "stream_delta") {
            const nestedSubagent =
              "subagent_id" in message.delta &&
              Boolean(message.delta.subagent_id);
            if (!message.subagent_id && !nestedSubagent) {
              assistantText += extractLettaAssistantText(message.delta);
              emitPublicAssistantText(false);
            }
            if (
              "message_type" in message.delta &&
              message.delta.message_type === "loop_error" &&
              message.delta.is_terminal
            ) {
              if (active.cancelled) {
                beginCancellationDrain();
                return;
              }
              finish(() =>
                reject(new Error(message.delta.message)),
              );
            }
            return;
          }

          if (message.type === "turn_finished") {
            if (active.cancelled) {
              finish(() => reject(new LettaTurnCancelledError()));
            } else if (message.error) {
              finish(() => reject(new Error(message.error)));
            } else {
              emitPublicAssistantText(true);
              finish(() => resolve(assistantText.trim()));
            }
          }
        });

        active.abortController.signal.addEventListener(
          "abort",
          beginCancellationDrain,
          { once: true },
        );

        timeout = setTimeout(() => {
          active.abortController.abort();
          void client.abort({ runtime }).catch(() => undefined);
          finish(() =>
            reject(
              new Error(
                `Letta turn exceeded ${Math.round(this.turnTimeoutMs / 1000)} seconds`,
              ),
            ),
          );
        }, this.turnTimeoutMs);

        if (active.cancelled) {
          beginCancellationDrain();
          void client.abort({ runtime }).catch(() => undefined);
          return;
        }

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
              if (active.cancelled) {
                beginCancellationDrain();
                return;
              }
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
          .catch((error) => {
            if (active.cancelled) {
              beginCancellationDrain();
              return;
            }
            finish(() => reject(error));
          });
      });
    } finally {
      active.runtime = undefined;
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
    signal?: AbortSignal,
  ): Promise<T> {
    const prior = this.conversationTails.get(contextId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queuedTail = prior.then(() => tail);
    this.conversationTails.set(contextId, queuedTail);
    try {
      await waitForPriorTurn(prior, signal);
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

function waitForPriorTurn(
  prior: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return prior;
  if (signal.aborted) return Promise.reject(new LettaTurnCancelledError());

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new LettaTurnCancelledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    prior.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
