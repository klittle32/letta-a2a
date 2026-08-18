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
        description: "Registered A2A agent name, such as agent-a or agent-b",
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
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;
  const endpoint = `${config.gatewayUrl.replace(/\/$/, "")}/a2a/${encodeURIComponent(target)}`;
  const sendRpc = async (body: Record<string, unknown>): Promise<unknown> => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.gatewayKey}`,
        "Content-Type": "application/json",
        "A2A-Version": "1.0",
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
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
  const deadline = Date.now() + timeoutMs;
  while (task && !isTerminalTaskState(taskState(task))) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out polling A2A task ${String(task.id ?? "unknown")}`);
    }
    if (pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    payload = await sendRpc({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "GetTask",
      params: { id: task.id },
    });
    task = taskFromPayload(payload);
  }

  if (task) {
    const state = taskState(task);
    if (!state?.endsWith("COMPLETED")) {
      const status = asRecord(task.status);
      const detail = extractMessageText(asRecord(status?.message));
      throw new Error(
        `A2A task ${String(task.id ?? "unknown")} ended as ${state ?? "unknown"}${detail ? `: ${detail}` : ""}`,
      );
    }
    payload = {
      jsonrpc: "2.0",
      id: randomUUID(),
      result: { task },
    };
  }

  return extractA2AResponse(payload);
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
