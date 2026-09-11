import { setTimeout as sleep } from "node:timers/promises";

import {
  type Message,
  Role,
  type SendMessageResult,
  type Task,
  TaskState,
} from "@a2a-js/sdk";
import {
  type Client,
  ClientFactory,
  JsonRpcTransportFactory,
  type RequestOptions,
} from "@a2a-js/sdk/client";

export interface A2AInvocation {
  url: string;
  message: string;
  contextId?: string;
  signal: AbortSignal;
}

export interface A2AInvocationResult {
  ok: boolean;
  status:
    | "completed"
    | "failed"
    | "cancelled"
    | "rejected"
    | "input_required"
    | "auth_required";
  taskId?: string;
  contextId?: string;
  text: string;
}

export interface A2AInvoker {
  invoke(input: A2AInvocation): Promise<A2AInvocationResult>;
}

export interface A2AClient {
  sendMessage(
    request: Parameters<Client["sendMessage"]>[0],
    options?: RequestOptions,
  ): Promise<SendMessageResult>;
  getTask(
    request: Parameters<Client["getTask"]>[0],
    options?: RequestOptions,
  ): Promise<Task>;
  cancelTask(
    request: Parameters<Client["cancelTask"]>[0],
    options?: RequestOptions,
  ): Promise<Task>;
}

export type A2AClientProvider = (url: string) => Promise<A2AClient>;

export interface PollingOptions {
  pollIntervalMs: number;
  timeoutMs: number;
}

export class A2AInvocationCancelledError extends Error {
  constructor() {
    super("A2A invocation was cancelled");
    this.name = "A2AInvocationCancelledError";
  }
}

/** Uses A2A's asynchronous task mode so cancellation and timeouts stay explicit. */
export class PollingA2AInvoker {
  constructor(
    private readonly clients: A2AClientProvider,
    private readonly options: PollingOptions,
  ) {}

  async invoke(input: A2AInvocation): Promise<A2AInvocationResult> {
    const client = await this.clients(input.url);
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs);
    const signal = AbortSignal.any([input.signal, timeoutSignal]);
    let acceptedTaskId: string | undefined;

    try {
      const sent = await client.sendMessage(
        {
          tenant: "",
          message: userMessage(input.message, input.contextId),
          configuration: {
            acceptedOutputModes: ["text/plain"],
            taskPushNotificationConfig: undefined,
            returnImmediately: true,
          },
          metadata: undefined,
        },
        { signal },
      );

      if (isMessage(sent)) return messageResult(sent);
      acceptedTaskId = sent.id;

      let task = sent;
      while (!isTerminal(task.status?.state)) {
        await sleep(this.options.pollIntervalMs, undefined, { signal });
        task = await client.getTask(
          { tenant: "", id: task.id, historyLength: 10 },
          { signal },
        );
      }
      return taskResult(task);
    } catch (error) {
      if (signal.aborted && acceptedTaskId) {
        await bestEffortCancel(client, acceptedTaskId);
      }
      if (input.signal.aborted) throw new A2AInvocationCancelledError();
      if (timeoutSignal.aborted) {
        throw new Error(
          `A2A invocation exceeded ${Math.round(this.options.timeoutMs / 1_000)} seconds`,
        );
      }
      throw error;
    }
  }
}

export function createOfficialClientProvider(): A2AClientProvider {
  const factory = new ClientFactory({
    transports: [new JsonRpcTransportFactory()],
  });
  const clients = new Map<string, Promise<Client>>();

  return (url) => {
    let client = clients.get(url);
    if (!client) {
      client = factory.createFromUrl(url);
      clients.set(url, client);
      void client.catch(() => clients.delete(url));
    }
    return client;
  };
}

function userMessage(text: string, contextId?: string): Message {
  return {
    messageId: crypto.randomUUID(),
    contextId: contextId ?? "",
    taskId: "",
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: "text", value: text },
        metadata: undefined,
        filename: "",
        mediaType: "text/plain",
      },
    ],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

function isMessage(result: SendMessageResult): result is Message {
  return "messageId" in result;
}

function messageResult(message: Message): A2AInvocationResult {
  return {
    ok: true,
    status: "completed",
    taskId: message.taskId || undefined,
    contextId: message.contextId || undefined,
    text: readMessageText(message),
  };
}

function taskResult(task: Task): A2AInvocationResult {
  const status = statusName(task.status?.state);
  const artifactText = task.artifacts.flatMap((artifact) =>
    artifact.parts.flatMap((part) =>
      part.content?.$case === "text" ? [part.content.value] : [],
    ),
  );
  const statusText = task.status?.message
    ? readMessageText(task.status.message)
    : "";

  return {
    ok: status === "completed",
    status,
    taskId: task.id,
    contextId: task.contextId,
    text: artifactText.join("") || statusText,
  };
}

function readMessageText(message: Message): string {
  return message.parts
    .flatMap((part) =>
      part.content?.$case === "text" ? [part.content.value] : [],
    )
    .join("");
}

function isTerminal(state: TaskState | undefined): boolean {
  return (
    state === TaskState.TASK_STATE_COMPLETED ||
    state === TaskState.TASK_STATE_FAILED ||
    state === TaskState.TASK_STATE_CANCELED ||
    state === TaskState.TASK_STATE_REJECTED ||
    state === TaskState.TASK_STATE_INPUT_REQUIRED ||
    state === TaskState.TASK_STATE_AUTH_REQUIRED
  );
}

function statusName(
  state: TaskState | undefined,
): A2AInvocationResult["status"] {
  switch (state) {
    case TaskState.TASK_STATE_COMPLETED:
      return "completed";
    case TaskState.TASK_STATE_FAILED:
      return "failed";
    case TaskState.TASK_STATE_CANCELED:
      return "cancelled";
    case TaskState.TASK_STATE_REJECTED:
      return "rejected";
    case TaskState.TASK_STATE_INPUT_REQUIRED:
      return "input_required";
    case TaskState.TASK_STATE_AUTH_REQUIRED:
      return "auth_required";
    default:
      throw new Error(`Task is not terminal: ${String(state)}`);
  }
}

async function bestEffortCancel(
  client: A2AClient,
  taskId: string,
): Promise<void> {
  try {
    await client.cancelTask(
      { tenant: "", id: taskId, metadata: undefined },
      { signal: AbortSignal.timeout(5_000) },
    );
  } catch {
    // The original timeout/cancellation remains the useful result.
  }
}
