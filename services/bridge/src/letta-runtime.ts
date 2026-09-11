import { LettaAgentClient } from "@letta-ai/letta-agent-sdk";
import WebSocket from "ws";
import {
  AgentSdkTurnRunner,
  createAgentToolGuard,
  createToolPolicy,
  type DurableBinding,
  type LettaTurnRequest,
  type LettaTurnResult,
  type SessionResources,
  type SessionScope,
} from "letta-a2a-bridge";
import type { AgentDefinition, GatewayUrls } from "./config.js";
import { ContextStore } from "./context-store.js";
import { A2A_EXTERNAL_TOOL, invokeA2A } from "./a2a-client.js";
import type { AccessTokenProvider } from "./oauth-client.js";
import type { CredentialOwner } from "letta-a2a-client";

export interface RuntimeDependencies {
  durability?: DurableBinding;
  credentialOwner?: CredentialOwner;
  createClient?: (
    options: ConstructorParameters<typeof LettaAgentClient>[0],
  ) => LettaAgentClient;
  invoke?: typeof invokeA2A;
}

/** Service policy only: the package owns execution, cancellation and quarantine. */
export class LettaRuntime {
  private runner?: AgentSdkTurnRunner;
  private connecting?: Promise<void>;
  private readonly shutdown = new AbortController();
  private readonly turns = new Set<Promise<LettaTurnResult>>();

  constructor(
    readonly definition: AgentDefinition,
    private readonly contextStore: ContextStore,
    private readonly model: string,
    private readonly turnTimeoutMs: number,
    private readonly a2aGatewayUrls: GatewayUrls,
    private readonly a2aTokenProvider: AccessTokenProvider,
    private readonly maximumA2AHops: number,
    private readonly dependencies: RuntimeDependencies = {},
  ) {}

  connect(): Promise<void> {
    if (this.shutdown.signal.aborted)
      return Promise.reject(new Error("Letta runtime is closed"));
    return (this.connecting ??= this.initialize());
  }

  private async initialize(): Promise<void> {
    // A distinct SDK remote client binds each definition to its own App Server.
    const client = (
      this.dependencies.createClient ??
      ((options) => new LettaAgentClient(options))
    )({
      backend: "remote",
      url: this.definition.appServerUrl,
      authToken: this.definition.appServerToken,
      WebSocket,
      requestTimeoutMs: 30_000,
      pinGlobalAgent: true,
    });
    const candidates = (await client.agents.list()).filter(
      (agent) => agent.name === this.definition.displayName,
    );
    if (candidates.length > 1)
      throw new Error(
        "Multiple Letta agents match the configured display name",
      );
    const agentId =
      candidates[0]?.id ??
      (await client.createAgent({
        name: this.definition.displayName,
        description: `${this.definition.displayName} in the isolated bidirectional A2A lab.`,
        model: this.model,
        baseTools: [],
        memfs: false,
        // Remote createAgent rejects session allowlists and permission callbacks.
        // Creation sends no input; strict tool policy is applied to every turn below.
        memory: [
          {
            label: "persona",
            value: `You are ${this.definition.displayName} in an isolated A2A interoperability lab. Be concise. When explicitly asked to consult the other lab agent, use a2a_invoke if available and report the result.`,
          },
        ],
      }));
    // Pin the resolved identity before the runner can resume or create a session.
    this.dependencies.durability?.bindAgent(agentId);
    const guard = createAgentToolGuard(client, agentId);
    this.runner = new AgentSdkTurnRunner(client, agentId, {
      sharingDomain: this.definition.key,
      beforeTurn: (request) => guard(request.signal),
      // Exact owner-scoped keys only. Legacy unowned entries remain untouched.
      // Durable opt-in never adopts the legacy idle-continuity map.
      execution: this.dependencies.durability?.execution,
      conversationMapping: this.dependencies.durability
        ?.conversationMapping ?? {
        get: (key) => this.contextStore.get(this.definition.key, key),
        set: (key, conversationId) =>
          this.contextStore.save(this.definition.key, key, conversationId),
      },
      sessionOptions: (scope) => this.sessionResources(scope),
    });
  }

  get unresolvedContexts(): readonly string[] {
    return [
      ...new Set([
        ...(this.runner?.unresolvedContexts ?? []),
        ...(this.dependencies.durability?.unresolvedContexts ?? []),
      ]),
    ];
  }

  runTurn(request: LettaTurnRequest): Promise<LettaTurnResult> {
    if (!this.runner)
      return Promise.reject(new Error("Letta runtime is not connected"));
    if (this.shutdown.signal.aborted)
      return Promise.reject(new Error("Letta runtime is closed"));
    const timeout = new AbortController();
    const timer = setTimeout(
      () => timeout.abort(new Error("Letta turn timed out")),
      this.turnTimeoutMs,
    );
    const signal = AbortSignal.any([
      request.signal,
      timeout.signal,
      this.shutdown.signal,
    ]);
    // Do not race a timeout against the runner: ownership lasts until real settlement.
    const turn = this.runner.runTurn({ ...request, signal }).finally(() => {
      clearTimeout(timer);
      this.turns.delete(turn);
    });
    this.turns.add(turn);
    return turn;
  }

  async close(): Promise<void> {
    this.shutdown.abort();
    await Promise.allSettled([...this.turns]);
    // SDK 0.8.3 has no public client/management close API. Session disposal is
    // owned by AgentSdkTurnRunner; never reach into the SDK's pooled transport.
  }

  private sessionResources(scope: SessionScope): SessionResources {
    const delegation = scope.caller?.delegation;
    const allowed =
      delegation?.allowDelegation === true &&
      Number.isSafeInteger(delegation.hop) &&
      delegation.hop >= 0 &&
      delegation.hop < this.maximumA2AHops;
    const controller = new AbortController();
    const signal = AbortSignal.any([scope.signal, controller.signal]);
    const pending = new Set<Promise<unknown>>();
    const invoke = this.dependencies.invoke ?? invokeA2A;
    let closed = false;
    return {
      options: {
        ...createToolPolicy(allowed ? [A2A_EXTERNAL_TOOL.name] : []),
        cwd: "/workspace",
        tools: allowed
          ? [
              {
                ...A2A_EXTERNAL_TOOL,
                execute: async (_toolCallId, input) => {
                  if (closed)
                    throw new Error("Session tool resources are closed");
                  signal.throwIfAborted();
                  const args = input as Record<string, unknown> | null;
                  if (
                    !args ||
                    typeof args.target !== "string" ||
                    typeof args.message !== "string"
                  ) {
                    throw new Error("target and message must be strings");
                  }
                  const gatewayUrl = Object.hasOwn(
                    this.a2aGatewayUrls,
                    args.target,
                  )
                    ? this.a2aGatewayUrls[args.target]
                    : undefined;
                  if (!gatewayUrl)
                    throw new Error(
                      "No configured A2A gateway route for target",
                    );
                  // Model input may select a configured target, never caller identity or hop.
                  const invocation = invoke(
                    {
                      target: args.target,
                      message: args.message,
                      context_id:
                        typeof args.context_id === "string"
                          ? args.context_id
                          : undefined,
                      hop: delegation!.hop + 1,
                    },
                    {
                      gatewayUrl,
                      tokenProvider: this.a2aTokenProvider,
                      credentialOwner: this.dependencies.credentialOwner,
                    },
                    fetch,
                    signal,
                  );
                  pending.add(invocation);
                  try {
                    const result = await invocation;
                    return {
                      content: [{ type: "text", text: JSON.stringify(result) }],
                    };
                  } finally {
                    pending.delete(invocation);
                  }
                },
              },
            ]
          : [],
      },
      async close() {
        closed = true;
        controller.abort();
        // Drain the actual outbound promise, not a cancellation acknowledgement.
        await Promise.allSettled([...pending]);
      },
    };
  }
}
