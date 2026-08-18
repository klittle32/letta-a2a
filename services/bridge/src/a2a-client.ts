import { randomUUID } from "node:crypto";

import {
  extractA2AResponse,
  extractMessageText,
  type A2AInvocationResult,
} from "./mapping.js";

export interface InvokeA2AArgs {
  target: string;
  message: string;
  context_id?: string;
  hop?: number;
}

export interface A2AClientConfig {
  gatewayUrl: string;
  gatewayKey: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  cancelTimeoutMs?: number;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class A2AInvocationCancelledError extends Error {
  constructor(readonly remoteTaskId?: string) {
    super(
      remoteTaskId
        ? `A2A invocation was cancelled; remote task ${remoteTaskId} was asked to cancel`
        : "A2A invocation was cancelled before a remote task was accepted",
    );
    this.name = "A2AInvocationCancelledError";
  }
}

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
        description: "Optional prior A2A context ID for conversation continuity",
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
): Promise<A2AInvocationResult> {
  const target = args.target.trim();
  const message = args.message.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target)) {
    throw new Error("target must be a lowercase A2A agent name");
  }
  if (!message) throw new Error("message is required");

  const requestMessage: Record<string, unknown> = {
    messageId: randomUUID(),
    role: "ROLE_USER",
    parts: [{ text: message }],
  };
  if (args.context_id?.trim()) {
    requestMessage.contextId = args.context_id.trim();
  }

  const timeoutMs = config.timeoutMs ?? 120_000;
  const pollIntervalMs = config.pollIntervalMs ?? 250;
  const cancelTimeoutMs = config.cancelTimeoutMs ?? 5_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const endpoint = `${config.gatewayUrl.replace(/\/$/, "")}/a2a/${encodeURIComponent(target)}`;
  const sendRpc = async (
    body: Record<string, unknown>,
    requestSignal: AbortSignal = combinedSignal,
  ): Promise<unknown> => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.gatewayKey}`,
        "Content-Type": "application/json",
        "A2A-Version": "1.0",
      },
      body: JSON.stringify(body),
      signal: requestSignal,
    });
    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(`LiteLLM A2A request failed (${response.status}): ${rawBody}`);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new Error("LiteLLM returned a non-JSON A2A response");
    }
    const envelope = asRecord(payload);
    if (envelope?.error !== undefined) {
      throw new Error(`LiteLLM returned an A2A error: ${JSON.stringify(envelope.error)}`);
    }
    return payload;
  };

  let remoteTaskId: string | undefined;
  const cancelRemoteTask = async (): Promise<void> => {
    if (!remoteTaskId) return;
    try {
      await sendRpc(
        {
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "CancelTask",
          params: { id: remoteTaskId },
        },
        AbortSignal.timeout(cancelTimeoutMs),
      );
    } catch {
      // Cancellation is best effort. Preserve the caller's cancellation or
      // timeout outcome rather than replacing it with cleanup failure.
    }
  };

  try {
    let payload = await sendRpc({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "SendMessage",
      params: {
        message: requestMessage,
        metadata: {
          lettaA2aLab: {
            hop:
              typeof args.hop === "number" && args.hop >= 0
                ? Math.floor(args.hop)
                : 0,
          },
        },
        configuration: { returnImmediately: true },
      },
    });

    let task = taskFromPayload(payload);
    remoteTaskId = stringValue(task?.id);
    if (!task || !remoteTaskId) {
      throw new Error("Asynchronous A2A SendMessage returned no task");
    }
    while (!isTerminalTaskState(taskState(task))) {
      if (pollIntervalMs > 0) {
        await abortableDelay(pollIntervalMs, combinedSignal);
      }
      payload = await sendRpc({
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "GetTask",
        params: { id: remoteTaskId },
      });
      task = taskFromPayload(payload);
      if (!task) {
        throw new Error(`GetTask returned no task for ${remoteTaskId}`);
      }
    }

    const state = taskState(task);
    if (!state?.endsWith("COMPLETED")) {
      const status = asRecord(task.status);
      const detail = extractMessageText(asRecord(status?.message));
      throw new Error(
        `A2A task ${String(task.id ?? "unknown")} ended as ${state ?? "unknown"}${detail ? `: ${detail}` : ""}`,
      );
    }
    return extractA2AResponse({
      jsonrpc: "2.0",
      id: randomUUID(),
      result: { task },
    });
  } catch (error) {
    if (signal?.aborted || timeoutSignal.aborted) {
      await cancelRemoteTask();
      if (signal?.aborted) {
        throw new A2AInvocationCancelledError(remoteTaskId);
      }
      throw new Error(
        `A2A invocation timed out after ${Math.round(timeoutMs / 1000)} seconds${remoteTaskId ? ` while waiting for ${remoteTaskId}` : ""}`,
        { cause: error },
      );
    }
    throw error;
  }
}

function taskFromPayload(payload: unknown): Record<string, unknown> | undefined {
  const result = asRecord(asRecord(payload)?.result);
  return asRecord(result?.task) ??
    (result?.id !== undefined && result.status !== undefined ? result : undefined);
}

function taskState(task: Record<string, unknown>): string | undefined {
  const state = asRecord(task.status)?.state;
  return typeof state === "string" ? state : undefined;
}

function isTerminalTaskState(state: string | undefined): boolean {
  return Boolean(
    state &&
      ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].some((suffix) =>
        state.endsWith(suffix),
      ),
  );
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, any>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
