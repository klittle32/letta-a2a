import { setTimeout as sleep } from "node:timers/promises";
import {
  Message,
  Role,
  type SendMessageRequest,
  type SendMessageResult,
  type StreamResponse,
  type Task,
  TaskState,
} from "@a2a-js/sdk";
import {
  type Client,
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from "@a2a-js/sdk/client";
import { Operation } from "./operation.js";

export type A2AClient = Client;
export type A2AClientProvider = (
  url: string,
  signal?: AbortSignal,
) => Promise<Client>;
export type A2AInvocationResult = SendMessageResult;

export interface A2AInvocation {
  url: string;
  message: string | Message;
  contextId?: string;
  taskId?: string;
  signal: AbortSignal;
  /** Absolute performance.now() deadline in this process, including cleanup. */
  deadline?: number;
  onTask?: (task: Task) => void | Promise<void>;
}

export interface A2AInvoker {
  invoke(input: A2AInvocation): Promise<A2AInvocationResult>;
  getTask(url: string, id: string, signal?: AbortSignal): Promise<Task>;
  cancelTask(url: string, id: string, signal?: AbortSignal): Promise<Task>;
  stream(input: A2AInvocation): AsyncGenerator<StreamResponse, void, undefined>;
  subscribe(
    url: string,
    id: string,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamResponse, void, undefined>;
  connect(url: string, signal?: AbortSignal): Promise<Client>;
}

export interface PollingOptions {
  pollIntervalMs: number;
  timeoutMs: number;
  cancelTimeoutMs?: number;
}

export interface A2AInvocationErrorDetails {
  submissionAttempted: boolean;
  messageId?: string;
  task?: Task;
  cancellation?: Task;
  cause?: unknown;
}

export class A2AInvocationError extends Error {
  readonly submissionAttempted: boolean;
  readonly messageId?: string;
  readonly task?: Task;
  /** Authoritative CancelTask readback; only CANCELED confirms cancellation. */
  readonly cancellation?: Task;

  constructor(
    message: string,
    details: A2AInvocationErrorDetails = { submissionAttempted: false },
  ) {
    super(message, { cause: details.cause });
    this.name = "A2AInvocationError";
    this.submissionAttempted = details.submissionAttempted;
    this.messageId = details.messageId;
    this.task = details.task;
    this.cancellation = details.cancellation;
  }
}

export class A2AInvocationCancelledError extends A2AInvocationError {
  constructor(
    details: A2AInvocationErrorDetails = { submissionAttempted: false },
  ) {
    super("A2A invocation was cancelled", details);
    this.name = "A2AInvocationCancelledError";
  }
}

interface Identity {
  taskId?: string;
  contextId?: string;
}

interface Execution extends A2AInvocationErrorDetails {
  client?: Client;
  acceptedId?: string;
  identity: Identity;
}

/** Lossless protocol operations; no submission retries or synthesized task states. */
export class PollingA2AInvoker implements A2AInvoker {
  private readonly cancelTimeoutMs: number;

  constructor(
    private readonly clients: A2AClientProvider,
    private readonly options: PollingOptions,
  ) {
    this.cancelTimeoutMs = options.cancelTimeoutMs ?? 1_000;
    if (
      !Number.isFinite(options.timeoutMs) ||
      options.timeoutMs <= 0 ||
      !Number.isFinite(options.pollIntervalMs) ||
      options.pollIntervalMs < 0 ||
      !Number.isFinite(this.cancelTimeoutMs) ||
      this.cancelTimeoutMs <= 0
    ) {
      throw new Error(
        "A2A operation budgets must be finite and positive (poll interval may be zero)",
      );
    }
  }

  async invoke(input: A2AInvocation): Promise<A2AInvocationResult> {
    const operation = this.operation(input.signal, true, input.deadline);
    const execution: Execution = { submissionAttempted: false, identity: {} };
    try {
      const request = requestFor(input);
      execution.messageId = request.message?.messageId;
      execution.identity = {
        taskId: request.message?.taskId,
        contextId: request.message?.contextId,
      };
      const client = await operation.run(() =>
        this.clients(input.url, operation.signal),
      );
      execution.client = client;
      const sent = await operation.run(() => {
        execution.submissionAttempted = true;
        return client.sendMessage(request, { signal: operation.signal });
      });
      if ("messageId" in sent) {
        checkIdentity(execution.identity, sent.taskId, sent.contextId, false);
        return sent;
      }
      let task = sent;
      while (true) {
        await this.accept(task, execution, operation, input);
        if (isStopped(task.status?.state)) return task;
        await operation.run(() =>
          sleep(this.options.pollIntervalMs, undefined, {
            signal: operation.signal,
          }),
        );
        task = await operation.run(() =>
          client.getTask(
            { tenant: "", id: task.id, historyLength: undefined },
            { signal: operation.signal },
          ),
        );
      }
    } catch (cause) {
      await this.cancelAccepted(execution, operation);
      throw failure(operation, execution, cause);
    } finally {
      operation.close();
    }
  }

  /** Remaining official methods are available directly; their lifetimes belong to the caller. */
  connect(url: string, signal?: AbortSignal): Promise<Client> {
    return this.read(url, signal, (client) => client);
  }

  getTask(url: string, id: string, signal?: AbortSignal): Promise<Task> {
    return this.read(url, signal, async (client, operation) => {
      const task = await client.getTask(
        { tenant: "", id, historyLength: undefined },
        { signal: operation.signal },
      );
      checkIdentity({ taskId: id }, task.id, task.contextId);
      return task;
    });
  }

  cancelTask(url: string, id: string, signal?: AbortSignal): Promise<Task> {
    return this.read(url, signal, async (client, operation) => {
      const task = await client.cancelTask(
        { tenant: "", id, metadata: undefined },
        { signal: operation.signal },
      );
      checkIdentity({ taskId: id }, task.id, task.contextId);
      return task;
    });
  }

  /**
   * Low-level SDK events, unchanged. onTask durably correlates full snapshots
   * before delivery. Status/artifact-only streams expose IDs in those events,
   * not invented Task snapshots. Breaking early requests bounded cancellation
   * of accepted work; use getTask to reconcile (break cannot return readback).
   * EOF alone does not confirm task completion. Consumers must close/return
   * the iterator when abandoning it; consumer work between reads is not awaited.
   */
  stream(
    input: A2AInvocation,
  ): AsyncGenerator<StreamResponse, void, undefined> {
    return this.events(input.url, input.signal, input);
  }

  /** Closing a subscription detaches it, and never cancels the remote task. */
  subscribe(
    url: string,
    id: string,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamResponse, void, undefined> {
    return this.events(url, signal, undefined, id);
  }

  private operation(
    signal?: AbortSignal,
    cleanup = false,
    deadline?: number,
  ): Operation {
    return new Operation(
      this.options.timeoutMs,
      signal,
      cleanup ? this.cancelTimeoutMs : 0,
      deadline,
    );
  }

  private async read<T>(
    url: string,
    signal: AbortSignal | undefined,
    work: (client: Client, operation: Operation) => T | PromiseLike<T>,
  ): Promise<T> {
    const operation = this.operation(signal);
    try {
      const client = await operation.run(() =>
        this.clients(url, operation.signal),
      );
      return await operation.run(() => work(client, operation));
    } catch (cause) {
      throw failure(operation, { submissionAttempted: false }, cause);
    } finally {
      operation.close();
    }
  }

  private async accept(
    task: Task,
    execution: Execution,
    operation: Operation,
    input?: A2AInvocation,
  ): Promise<void> {
    pinIdentity(execution.identity, task.id, task.contextId);
    execution.task = task;
    execution.acceptedId = task.id;
    await operation.run(() => input?.onTask?.(task));
  }

  private async cancelAccepted(
    execution: Execution,
    operation: Operation,
  ): Promise<void> {
    const { client, acceptedId } = execution;
    if (!client || !acceptedId) return;
    execution.cancellation = await operation.cleanup(async (signal) => {
      const task = await client.cancelTask(
        { tenant: "", id: acceptedId, metadata: undefined },
        { signal },
      );
      checkIdentity(execution.identity, task.id, task.contextId);
      return task;
    }, this.cancelTimeoutMs);
  }

  private async *events(
    url: string,
    signal?: AbortSignal,
    input?: A2AInvocation,
    id?: string,
  ): AsyncGenerator<StreamResponse, void, undefined> {
    const operation = this.operation(signal, true, input?.deadline);
    const execution: Execution = {
      submissionAttempted: false,
      identity: { taskId: id },
    };
    let iterator: AsyncGenerator<StreamResponse, void, undefined> | undefined;
    let complete = false;
    let stopped = false;
    let failed = false;
    try {
      const request = input ? requestFor(input) : undefined;
      execution.messageId = request?.message?.messageId;
      if (request)
        execution.identity = {
          taskId: request.message?.taskId,
          contextId: request.message?.contextId,
        };
      const client = await operation.run(() =>
        this.clients(url, operation.signal),
      );
      execution.client = client;
      iterator = await operation.run(() =>
        request
          ? client.sendMessageStream(request, { signal: operation.signal })
          : client.resubscribeTask(
              { tenant: "", id: id! },
              { signal: operation.signal },
            ),
      );
      while (true) {
        const current = iterator;
        const next = await operation.run(() => {
          if (input) execution.submissionAttempted = true;
          return current.next();
        });
        if (next.done) {
          complete = true;
          return;
        }
        const payload = next.value.payload;
        if (payload?.$case === "task") {
          await this.accept(payload.value, execution, operation, input);
          stopped = isStopped(payload.value.status?.state);
        } else if (
          payload?.$case === "statusUpdate" ||
          payload?.$case === "artifactUpdate"
        ) {
          pinIdentity(
            execution.identity,
            payload.value.taskId,
            payload.value.contextId,
          );
          execution.acceptedId = payload.value.taskId;
          if (payload.$case === "statusUpdate")
            stopped = isStopped(payload.value.status?.state);
        } else if (payload?.$case === "message") {
          pinIdentity(
            execution.identity,
            payload.value.taskId,
            payload.value.contextId,
            false,
          );
        }
        yield next.value;
      }
    } catch (cause) {
      failed = true;
      if (input) await this.cancelAccepted(execution, operation);
      throw failure(operation, execution, cause);
    } finally {
      // Abort network reads before asking a non-cooperative iterator to close.
      // Cleanup has its own independent signal, capped by the overall deadline.
      if (input && !complete && !failed && !stopped)
        await this.cancelAccepted(execution, operation);
      operation.close();
      if (iterator) {
        const current = iterator;
        // Always request closure, even when cancellation consumed the budget.
        const closing = Promise.resolve().then(() => current.return());
        void closing.catch(() => {});
        await operation.cleanup(() => closing, this.cancelTimeoutMs);
      }
    }
  }
}

function failure(
  operation: Operation,
  details: A2AInvocationErrorDetails,
  cause: unknown,
): A2AInvocationError {
  const context = { ...details, cause };
  if (operation.caller?.aborted)
    return new A2AInvocationCancelledError(context);
  return new A2AInvocationError(
    operation.signal.aborted
      ? "A2A operation timed out"
      : "A2A operation failed",
    context,
  );
}

function requestFor(input: A2AInvocation): SendMessageRequest {
  const original =
    typeof input.message === "string"
      ? {
          messageId: crypto.randomUUID(),
          role: Role.ROLE_USER,
          contextId: "",
          taskId: "",
          metadata: undefined,
          extensions: [],
          referenceTaskIds: [],
          parts: [
            {
              content: { $case: "text" as const, value: input.message },
              mediaType: "text/plain",
              filename: "",
              metadata: undefined,
            },
          ],
        }
      : input.message;
  if (
    (input.contextId !== undefined &&
      original.contextId &&
      input.contextId !== original.contextId) ||
    (input.taskId !== undefined &&
      original.taskId &&
      input.taskId !== original.taskId)
  ) {
    throw new Error("Conflicting explicit A2A message identity");
  }
  return {
    tenant: "",
    message: {
      ...original,
      contextId: input.contextId ?? original.contextId,
      taskId: input.taskId ?? original.taskId,
    },
    configuration: {
      acceptedOutputModes: [],
      taskPushNotificationConfig: undefined,
      returnImmediately: true,
    },
    metadata: undefined,
  };
}

function checkIdentity(
  expected: Identity,
  taskId: string,
  contextId: string,
  requireTask = true,
): void {
  if (
    (requireTask && (!taskId || !contextId)) ||
    (expected.taskId && expected.taskId !== taskId) ||
    (expected.contextId && expected.contextId !== contextId)
  ) {
    throw new Error("A2A response identity conflicts with the operation");
  }
}

/** Validate all fields before changing either pinned identity field. */
function pinIdentity(
  expected: Identity,
  taskId: string,
  contextId: string,
  requireTask = true,
): void {
  checkIdentity(expected, taskId, contextId, requireTask);
  if (taskId) expected.taskId = taskId;
  if (contextId) expected.contextId = contextId;
}

function isStopped(state: TaskState | undefined): boolean {
  return (
    state === TaskState.TASK_STATE_COMPLETED ||
    state === TaskState.TASK_STATE_FAILED ||
    state === TaskState.TASK_STATE_CANCELED ||
    state === TaskState.TASK_STATE_REJECTED ||
    state === TaskState.TASK_STATE_INPUT_REQUIRED ||
    state === TaskState.TASK_STATE_AUTH_REQUIRED
  );
}

export interface OfficialClientProviderOptions {
  fetchImpl?: typeof fetch;
  discoveryTimeoutMs?: number;
}

/** Same-origin HTTP(S) route binding, not a general SSRF or authentication policy. */
export function createOfficialClientProvider(
  options: OfficialClientProviderOptions = {},
): A2AClientProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (url, signal) => {
    const operation = new Operation(
      options.discoveryTimeoutMs ?? 10_000,
      signal,
    );
    try {
      const origin = new URL(url);
      const check = (value: string) => {
        const target = new URL(value);
        if (
          !["http:", "https:"].includes(target.protocol) ||
          target.origin !== origin.origin
        ) {
          throw new Error(
            "A2A endpoint must use the configured HTTP(S) origin",
          );
        }
      };
      check(url);
      // Transport never captures the discovery/invocation signal or a cached client.
      const transportFetch = Object.assign(
        (
          request: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          check(
            typeof request === "string"
              ? request
              : request instanceof URL
                ? request.href
                : request.url,
          );
          return fetchImpl(request, { ...init, redirect: "error" });
        },
        fetchImpl,
      );
      const discoveryFetch = Object.assign(
        (
          request: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) =>
          operation.run(() =>
            transportFetch(request, {
              ...init,
              signal: operation.signal,
            }),
          ),
        fetchImpl,
      );
      const resolver = new DefaultAgentCardResolver({
        fetchImpl: discoveryFetch,
      });
      const factory = new ClientFactory({
        transports: [
          new JsonRpcTransportFactory({ fetchImpl: transportFetch }),
        ],
        cardResolver: {
          resolve: async (base, path) => {
            const card = await resolver.resolve(base, path);
            for (const endpoint of card.supportedInterfaces)
              check(endpoint.url);
            return card;
          },
        },
      });
      return await operation.run(() => factory.createFromUrl(url));
    } catch (cause) {
      throw failure(operation, { submissionAttempted: false }, cause);
    } finally {
      operation.close();
    }
  };
}
