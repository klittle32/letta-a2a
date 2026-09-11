import {
  LettaAgentClient,
  type SDKResultMessage,
} from "@letta-ai/letta-agent-sdk";

import type { ExampleConfig } from "./config.js";
import {
  assertNoPersistedAgentTools,
  createA2ASessionOptions,
} from "./tool-policy.js";

export interface LettaTurnRequest {
  a2aContextId: string;
  messageId: string;
  text: string;
  signal: AbortSignal;
  onAssistantText(text: string): void;
}

export interface LettaTurnResult {
  text: string;
}

export interface LettaTurnRunner {
  runTurn(request: LettaTurnRequest): Promise<LettaTurnResult>;
}

export class LettaTurnCancelledError extends Error {
  constructor() {
    super("The Letta turn was cancelled");
    this.name = "LettaTurnCancelledError";
  }
}

/**
 * Owns the Letta-specific half of the bridge.
 *
 * A2A context IDs and Letta conversation IDs are different identifiers. This
 * class keeps their relationship explicit and opens a fresh SDK session for
 * every turn. The Letta conversation persists after that session closes.
 */
export class AgentSdkTurnRunner implements LettaTurnRunner {
  private readonly conversations = new Map<string, string>();
  private readonly contextTails = new Map<string, Promise<void>>();

  constructor(
    private readonly client: LettaAgentClient,
    private readonly agentId: string,
    private readonly workingDirectory: string,
  ) {}

  runTurn(request: LettaTurnRequest): Promise<LettaTurnResult> {
    return this.withContextLock(request.a2aContextId, request.signal, () =>
      this.runTurnUnlocked(request),
    );
  }

  private async runTurnUnlocked(
    request: LettaTurnRequest,
  ): Promise<LettaTurnResult> {
    throwIfCancelled(request.signal);

    const knownConversationId = this.conversations.get(request.a2aContextId);
    await using session = knownConversationId
      ? this.client.resumeSession(knownConversationId, this.sessionOptions())
      : this.client.createSession(this.agentId, this.sessionOptions());

    const abortSession = () => {
      void session.abort().catch(() => undefined);
    };
    request.signal.addEventListener("abort", abortSession, { once: true });

    try {
      const ready = await session.ready();
      throwIfCancelled(request.signal);

      // Save the relationship before sending so every later task in this A2A
      // context resumes the same persistent Letta conversation.
      this.conversations.set(request.a2aContextId, ready.conversationId);

      await session.send(request.text, { otid: request.messageId });

      let assistantText = "";
      let latestError: string | undefined;
      let result: SDKResultMessage | undefined;

      for await (const message of session.stream()) {
        if (message.type === "assistant") {
          assistantText += message.content;
          request.onAssistantText(message.content);
        } else if (message.type === "error") {
          latestError = message.errorDetail ?? message.message;
        } else if (message.type === "result") {
          result = message;
        }
      }

      if (request.signal.aborted || result?.stopReason === "interrupted") {
        throw new LettaTurnCancelledError();
      }
      if (!result) {
        throw new Error("The Letta Agent SDK stream ended without a result");
      }
      if (!result.success) {
        throw new Error(
          latestError ??
            result.errorDetail ??
            result.error ??
            "The Letta turn failed",
        );
      }

      return {
        text: assistantText || result.result || "",
      };
    } finally {
      request.signal.removeEventListener("abort", abortSession);
    }
  }

  private sessionOptions() {
    return createA2ASessionOptions(this.workingDirectory);
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
      if (this.contextTails.get(contextId) === tail) {
        this.contextTails.delete(contextId);
      }
    }
  }
}

export async function resolveOrCreateAgent(
  client: LettaAgentClient,
  config: ExampleConfig,
): Promise<string> {
  if (config.lettaAgentId) {
    const agent = await client.agents.retrieve(config.lettaAgentId);
    assertNoPersistedAgentTools(agent);
    return agent.id;
  }

  // The local App Server currently returns the full agent list even when the
  // SDK request includes a name filter. Treat filtering as a client-side
  // responsibility so unrelated local agents do not look like duplicates.
  const matches = (await client.agents.list({ limit: 100 })).filter(
    (agent) => agent.name === config.lettaAgentName,
  );
  if (matches.length > 1) {
    throw new Error(
      `More than one Letta agent is named ${JSON.stringify(config.lettaAgentName)}; set A2A_LETTA_AGENT_ID explicitly`,
    );
  }
  if (matches[0]) {
    const agent = await client.agents.retrieve(matches[0].id);
    assertNoPersistedAgentTools(agent);
    return agent.id;
  }

  return client.createAgent({
    name: config.lettaAgentName,
    description: "A local Letta agent exposed by A2A Example 14.",
    ...(config.lettaModel ? { model: config.lettaModel } : {}),
    persona:
      "You are a concise assistant exposed through an A2A server. Preserve useful context across turns. When explicitly asked to consult a configured remote A2A target, use a2a_invoke and report its result.",
    human:
      "The caller is learning how A2A context maps to a persistent Letta conversation.",
    memfs: false,
    baseTools: [],
    permissionMode: "strict",
    tags: ["letta-a2a-example-14"],
  });
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
