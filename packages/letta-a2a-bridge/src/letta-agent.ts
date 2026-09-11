import type {
  LettaAgentClient,
  CreateSessionOptions,
  SDKResultMessage,
} from "@letta-ai/letta-agent-sdk";

import type { TrustedCaller } from "./request-policy.js";

export interface LettaTurnRequest {
  /** Dedicated owner-scoped conversation key, not the raw wire context ID. */
  a2aContextId: string;
  /** Trusted host identity; never populated from message metadata. */
  caller?: TrustedCaller;
  /** Original protocol context for host policy/correlation, not ownership. */
  protocolContextId?: string;
  messageId: string;
  text: string;
  signal: AbortSignal;
  onAssistantText(text: string): void;
}
/** Interruption is a trusted, settled runner outcome, never assistant-prose parsing.
 * Returning it guarantees this turn no longer owns active or uncertain execution.
 * detail is explicitly public text and must not contain credentials/private errors.
 */
export interface LettaTurnResult {
  text: string;
  state?: "completed" | "input_required" | "auth_required";
  detail?: string;
}
export interface LettaTurnRunner {
  runTurn(request: LettaTurnRequest): Promise<LettaTurnResult>;
  /** A settled call is not always proof that remote execution has ended. */
  readonly unresolvedContexts?: readonly string[];
}
export class LettaTurnCancelledError extends Error {
  constructor() {
    super("The Letta turn was cancelled");
    this.name = "LettaTurnCancelledError";
  }
}
export interface SessionScope {
  readonly agentId: string;
  readonly caller?: TrustedCaller;
  readonly a2aContextId: string;
  readonly protocolContextId?: string;
  readonly messageId: string;
  /** Becomes available after SDK readiness; never supplied by model arguments. */
  readonly conversationId: string | undefined;
  readonly signal: AbortSignal;
}
export interface SessionResources {
  options: CreateSessionOptions;
  close?(): void | Promise<void>;
}
export interface SessionPolicy {
  /** Trusted governance check inside the context lock, immediately before session setup. */
  beforeTurn?(request: LettaTurnRequest): void | Promise<void>;
  /** Optional idle-conversation continuity, called under the execution lock.
   * Keys are already owner-scoped by the host. Never fall back to unowned keys.
   * This is not active-task persistence or crash/restart reconciliation.
   * Errors fail closed; set must settle before any input is sent.
   */
  conversationMapping?: {
    get(contextId: string): string | undefined | Promise<string | undefined>;
    set(contextId: string, conversationId: string): void | Promise<void>;
  };
  /** Explicit shared trust domain; this runtime is not a multi-tenant mapper. */
  sharingDomain: string;
  /** Application must govern persisted tools separately before binding this runner. */
  sessionOptions:
    | CreateSessionOptions
    | ((scope: SessionScope) => SessionResources);
}

/** One execution owner, one existing agent, dedicated in-memory context mapping. */
export class AgentSdkTurnRunner implements LettaTurnRunner {
  private readonly conversations = new Map<string, string>();
  private readonly contextTails = new Map<string, Promise<void>>();
  private readonly unresolved = new Set<string>();

  constructor(
    private readonly client: Pick<
      LettaAgentClient,
      "createSession" | "resumeSession"
    >,
    private readonly agentId: string,
    private readonly policy: SessionPolicy,
  ) {
    if (!agentId || !policy.sharingDomain.trim())
      throw new Error(
        "An existing agent and explicit sharing domain are required",
      );
  }

  get unresolvedContexts(): readonly string[] {
    return [...this.unresolved];
  }

  runTurn(request: LettaTurnRequest): Promise<LettaTurnResult> {
    return this.withContextLock(request.a2aContextId, request.signal, () =>
      this.runTurnUnlocked(request),
    );
  }

  private async runTurnUnlocked(
    request: LettaTurnRequest,
  ): Promise<LettaTurnResult> {
    throwIfCancelled(request.signal);
    if (this.unresolved.has(request.a2aContextId))
      throw new Error("Context execution requires reconciliation");
    await this.policy.beforeTurn?.(request);
    throwIfCancelled(request.signal);
    const known =
      this.conversations.get(request.a2aContextId) ??
      (await this.policy.conversationMapping?.get(request.a2aContextId));
    throwIfCancelled(request.signal);
    let conversationId = known;
    const setup: SessionResources =
      typeof this.policy.sessionOptions === "function"
        ? this.policy.sessionOptions({
            agentId: this.agentId,
            caller: request.caller,
            a2aContextId: request.a2aContextId,
            protocolContextId: request.protocolContextId,
            messageId: request.messageId,
            get conversationId() {
              return conversationId;
            },
            signal: request.signal,
          })
        : { options: this.policy.sessionOptions };
    let sent = false;
    let result: SDKResultMessage | undefined;
    let assistantText = "";
    try {
      try {
        await using session = known
          ? this.client.resumeSession(known, setup.options)
          : this.client.createSession(this.agentId, setup.options);
        const abortSession = () => {
          void session.abort().catch(() => undefined);
        };
        request.signal.addEventListener("abort", abortSession, { once: true });
        try {
          const ready = await session.ready();
          throwIfCancelled(request.signal);
          conversationId = ready.conversationId;
          await this.policy.conversationMapping?.set(
            request.a2aContextId,
            ready.conversationId,
          );
          throwIfCancelled(request.signal);
          this.conversations.set(request.a2aContextId, ready.conversationId);
          // An ambiguous send must not be retried or followed by another turn.
          sent = true;
          await session.send(request.text, { otid: request.messageId });
          for await (const message of session.stream()) {
            if (message.type === "assistant") {
              assistantText += message.content;
              request.onAssistantText(message.content);
            } else if (message.type === "result") result = message;
          }
        } finally {
          request.signal.removeEventListener("abort", abortSession);
        }
      } finally {
        // SDK 0.8.3 does not pass a cancellation signal to external tools.
        // Their controller-owned lifecycle must be closed explicitly too.
        await setup.close?.();
      }
    } catch (error) {
      // Includes ambiguous sends, stream exceptions, and failed async disposal.
      if (sent) this.unresolved.add(request.a2aContextId);
      throw error;
    }

    // Interpret the outcome only after session disposal has settled. The SDK
    // synthesizes failed results on disconnection, so receiving a result alone
    // is not evidence that execution stopped. Conservative quarantine is safer
    // than guessing which unsuccessful results came from a live runtime.
    if (!result) {
      this.unresolved.add(request.a2aContextId);
      throw new Error("The Letta Agent SDK stream ended without a result");
    }
    if (result.stopReason === "interrupted")
      throw new LettaTurnCancelledError();
    if (!result.success || result.stopReason === "requires_approval") {
      this.unresolved.add(request.a2aContextId);
      throw new Error("The Letta turn requires reconciliation");
    }
    if (request.signal.aborted) throw new LettaTurnCancelledError();
    return { text: assistantText || result.result || "" };
  }

  private async withContextLock<T>(
    contextId: string,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.contextTails.get(contextId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.contextTails.set(contextId, tail);
    try {
      await waitForPreviousTurn(previous, signal);
      return await work();
    } finally {
      release();
      // Preserve the predecessor's barrier when a waiting turn is cancelled.
      void tail.then(() => {
        if (this.contextTails.get(contextId) === tail)
          this.contextTails.delete(contextId);
      });
    }
  }
}
function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new LettaTurnCancelledError();
}
function waitForPreviousTurn(
  previous: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(new LettaTurnCancelledError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new LettaTurnCancelledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    previous.then(
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
