import { Message, TaskState, taskStateToJSON, type Part } from "@a2a-js/sdk";
import {
  A2AInvocationError,
  A2AInvocationCancelledError,
  PollingA2AInvoker,
  createOfficialClientProvider,
  type CredentialOwner,
} from "letta-a2a-client";
import type { A2AInvocationResult } from "./mapping.js";
import type { AccessTokenProvider } from "./oauth-client.js";

export { A2AInvocationCancelledError } from "letta-a2a-client";

/** Compact legacy success shape, with explicit resumable interruption detail. */
export interface OutboundA2AResult extends A2AInvocationResult {
  status?: string;
  statusMessage?: string;
}

export interface InvokeA2AArgs {
  target: string;
  message: string;
  context_id?: string;
  /** Trusted host value, deliberately absent from the model tool schema. */
  hop?: number;
}

export interface A2AClientConfig {
  gatewayUrl: string;
  tokenProvider: AccessTokenProvider;
  /** Stable host identity; service callers should always supply this explicitly. */
  credentialOwner?: CredentialOwner;
  pollIntervalMs?: number;
  timeoutMs?: number;
  cancelTimeoutMs?: number;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const A2A_EXTERNAL_TOOL = {
  name: "a2a_invoke",
  label: "Invoke A2A agent",
  description:
    "Delegate a text task to another named agent through the isolated A2A gateway. Reuse context_id for follow-up messages to the same remote conversation.",
  parameters: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description:
          "Registered A2A agent name, such as agent-a, agent-b, or reference-agent",
      },
      message: {
        type: "string",
        description:
          "Complete standalone instruction for the remote agent. Include what it should do; never pass only the expected answer token.",
      },
      context_id: {
        type: "string",
        description:
          "Optional prior A2A context ID for conversation continuity",
      },
    },
    required: ["target", "message"],
    additionalProperties: false,
  },
} as const;

export async function invokeA2A(
  args: InvokeA2AArgs,
  config: A2AClientConfig,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<OutboundA2AResult> {
  const target = args.target.trim();
  const message = args.message.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target)) {
    throw new Error("target must be a lowercase A2A agent name");
  }
  if (!message) throw new Error("message is required");
  const hop = Number.isSafeInteger(args.hop) && args.hop! >= 0 ? args.hop! : 0;
  // SDK discovery resolves relative to a directory; preserve the mounted target.
  const endpoint = `${config.gatewayUrl.replace(/\/$/, "")}/a2a/${target}/`;
  const origin = new URL(endpoint).origin;
  const owner = config.credentialOwner ?? "legacy-bridge-outbound";
  try {
    const provider = createOfficialClientProvider({
      fetchImpl: Object.assign(fetchImpl, fetch),
      policies: {
        [endpoint]: {
          destinationOrigins: [origin],
          peerIdentity: endpoint,
          headers: { "x-letta-a2a-hop": String(hop) },
          credential: {
            owner,
            audience: typeof owner === "string" ? origin : owner.audience,
            origins: [origin],
            headerNames: ["authorization"],
            provide: async ({ signal, audience }) => ({
              owner,
              audience,
              headers: {
                authorization: `Bearer ${await config.tokenProvider.getAccessToken(signal)}`,
              },
            }),
          },
        },
      },
    });
    const invoker = new PollingA2AInvoker(
      async (url, requestSignal) => {
        const client = await provider(url, requestSignal);
        const send = client.sendMessage.bind(client);
        // Application compatibility only: enrich the SDK's typed request, never
        // rewrite wire JSON or duplicate discovery, polling, or cancellation.
        client.sendMessage = (request, options) =>
          send(
            {
              ...request,
              metadata: { ...request.metadata, lettaA2aLab: { hop } },
            },
            options,
          );
        return client;
      },
      {
        timeoutMs: config.timeoutMs ?? 120_000,
        pollIntervalMs: config.pollIntervalMs ?? 250,
        cancelTimeoutMs: config.cancelTimeoutMs ?? 5_000,
      },
    );
    const result = await invoker.invoke({
      url: endpoint,
      message: Message.fromJSON({
        messageId: crypto.randomUUID(),
        role: "ROLE_USER",
        parts: [{ text: message }],
      }),
      contextId: args.context_id?.trim() || undefined,
      signal: signal ?? new AbortController().signal,
    });
    if ("messageId" in result) {
      return {
        contextId: result.contextId || undefined,
        taskId: result.taskId || undefined,
        text: text(result.parts),
      };
    }
    const state = result.status?.state;
    const compact = {
      contextId: result.contextId,
      taskId: result.id,
      text: result.artifacts.map((artifact) => text(artifact.parts)).join(""),
    };
    if (state === TaskState.TASK_STATE_COMPLETED) return compact;
    if (
      state === TaskState.TASK_STATE_INPUT_REQUIRED ||
      state === TaskState.TASK_STATE_AUTH_REQUIRED
    ) {
      return {
        ...compact,
        status: taskStateToJSON(state),
        statusMessage: text(result.status?.message?.parts ?? []),
      };
    }
    const details = { submissionAttempted: true, task: result };
    if (state === TaskState.TASK_STATE_CANCELED)
      throw new A2AInvocationCancelledError(details);
    throw new A2AInvocationError("A2A task did not complete", details);
  } catch (error) {
    // Keep public protocol detail and cancellation identity, but not nested
    // transport/OAuth causes (which may contain private bodies or credentials).
    const details =
      error instanceof A2AInvocationError
        ? {
            submissionAttempted: error.submissionAttempted,
            messageId: error.messageId,
            task: error.task,
            cancellation: error.cancellation,
          }
        : { submissionAttempted: false };
    if (error instanceof A2AInvocationCancelledError)
      throw new A2AInvocationCancelledError(details);
    throw new A2AInvocationError(
      error instanceof A2AInvocationError
        ? error.message
        : "A2A operation failed",
      details,
    );
  }
}

function text(parts: Part[]): string {
  return parts
    .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
    .join("");
}
