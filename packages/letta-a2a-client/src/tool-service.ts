import { randomUUID } from "node:crypto";
import { Message, Role, TaskState, type Task } from "@a2a-js/sdk";
import type { Client } from "@a2a-js/sdk/client";
import {
  A2AInvocationError,
  A2AInvocationCancelledError,
  type A2AInvocationErrorDetails,
  type A2AInvoker,
} from "./a2a-invoker.js";
import type { ContextStore } from "./context-store.js";

export interface A2AToolInput {
  target: string;
  message: string | Message;
  localScope: string;
  contextId?: string;
  taskId?: string;
  newContext?: boolean;
  signal: AbortSignal;
}

export interface A2AToolTaskInput {
  target: string;
  localScope: string;
  taskId: string;
  action: "get" | "cancel";
  signal?: AbortSignal;
}

export interface A2AToolServiceOptions {
  timeoutMs?: number;
  /** Host-derived opaque caller/peer policy identities keyed by endpoint. */
  identities?: Readonly<Record<string, string>>;
}

/** Controller metadata only: never persist messages, artifacts or credentials. */
interface RecordState {
  contextId?: string;
  taskId?: string;
  state?: TaskState;
  messageId?: string;
  pending?: boolean;
  /** This message has not been correlated with an accepted response. */
  submissionUnknown?: boolean;
}

const bindingKey = (scope: string, url: string) =>
  JSON.stringify(["a2a-binding", scope, url]);
const executionKey = (url: string, context: string) =>
  JSON.stringify(["a2a-execution", url, context]);
const terminal = (state?: TaskState) =>
  state === TaskState.TASK_STATE_COMPLETED ||
  state === TaskState.TASK_STATE_FAILED ||
  state === TaskState.TASK_STATE_CANCELED ||
  state === TaskState.TASK_STATE_REJECTED;
const interrupted = (state?: TaskState) =>
  state === TaskState.TASK_STATE_INPUT_REQUIRED ||
  state === TaskState.TASK_STATE_AUTH_REQUIRED;

/** Route policy and durable conversation ownership around the protocol client. */
export class A2AToolService {
  private readonly closed = new AbortController();
  private readonly owners = new WeakMap<AbortSignal, Set<Promise<unknown>>>();
  private readonly timeoutMs: number;
  private readonly identities: Readonly<Record<string, string>>;

  private storageEndpoint(url: string): string {
    return this.identities[url]
      ? JSON.stringify(["a2a-policy", url, this.identities[url]])
      : url;
  }

  constructor(
    private readonly routes: Record<string, string>,
    private readonly invoker: A2AInvoker,
    private readonly contexts: ContextStore,
    options: A2AToolServiceOptions = {},
  ) {
    this.identities = Object.freeze({ ...options.identities });
    this.timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0)
      throw new Error("A2A timeoutMs must be positive and finite");
  }

  targets(): string[] {
    return Object.keys(this.routes).sort();
  }

  connect(target: string, signal?: AbortSignal): Promise<Client> {
    return this.operation(signal, {}, (s) =>
      this.invoker.connect(this.endpoint(target), s),
    );
  }

  close(): void {
    this.closed.abort(new Error("A2A service closed"));
  }

  /** Local operation/persistence completion, distinct from remote cancellation. */
  async drain(signal: AbortSignal): Promise<void> {
    await Promise.allSettled([...(this.owners.get(signal) ?? [])]);
  }

  task(input: A2AToolTaskInput): Promise<Task> {
    return this.operation(input.signal, {}, async (signal) => {
      const url = this.endpoint(input.target);
      if (!input.taskId) throw new Error("A2A taskId is required");
      if (input.action !== "get" && input.action !== "cancel")
        throw new Error("Invalid A2A task action");
      // Remote peer credentials authorize task access. Local scope is continuity,
      // not an invented tenant boundary. Never queue cancellation behind a send.
      const binding = await this.load(
        bindingKey(input.localScope, this.storageEndpoint(url)),
      );
      signal.throwIfAborted();
      const result = await (input.action === "get"
        ? this.invoker.getTask(url, input.taskId, signal)
        : this.invoker.cancelTask(url, input.taskId, signal));
      this.check(
        result,
        input.taskId,
        binding.taskId === input.taskId ? binding.contextId : undefined,
      );
      // Deliberately no unlocked writes: the next invoke performs GetTask.
      return result;
    });
  }

  invoke(input: A2AToolInput): Promise<Task | Message> {
    const details: A2AInvocationErrorDetails = { submissionAttempted: false };
    return this.operation(input.signal, details, async (signal, deadline) => {
      const url = this.endpoint(input.target);
      if (typeof input.message === "string" && !input.message.trim())
        throw new Error("A2A message is required");
      const message: Message =
        typeof input.message === "string"
          ? {
              messageId: randomUUID(),
              role: Role.ROLE_USER,
              contextId: "",
              taskId: "",
              metadata: undefined,
              extensions: [],
              referenceTaskIds: [],
              parts: [
                {
                  content: { $case: "text", value: input.message.trim() },
                  mediaType: "text/plain",
                  filename: "",
                  metadata: undefined,
                },
              ],
            }
          : {
              ...input.message,
              messageId: input.message.messageId || randomUUID(),
            };
      if (
        (input.contextId &&
          message.contextId &&
          input.contextId !== message.contextId) ||
        (input.taskId && message.taskId && input.taskId !== message.taskId)
      )
        throw new Error("Conflicting explicit A2A message identity");
      const explicitContext = input.contextId || message.contextId || undefined;
      const taskId = input.taskId || message.taskId || undefined;
      if (input.newContext && (explicitContext || taskId))
        throw new Error(
          "new_context cannot be combined with context_id or task_id",
        );
      const key = bindingKey(input.localScope, this.storageEndpoint(url));
      return this.contexts.withLock(key, signal, async () => {
        const binding = await this.load(key);
        this.requireReadback(binding);
        if (!binding.contextId && !explicitContext && !input.newContext) {
          const legacy = await this.contexts.get(
            `${input.localScope}/${input.target}`,
          );
          if (legacy)
            throw new A2AInvocationError(
              `Legacy A2A context ${JSON.stringify(legacy)} has no endpoint identity. Supply context_id explicitly to migrate it, or new_context to start independently; the legacy entry is preserved.`,
            );
        }
        let contextId =
          explicitContext ?? (input.newContext ? undefined : binding.contextId);
        if (taskId) {
          signal.throwIfAborted();
          const found = await this.invoker.getTask(url, taskId, signal);
          this.check(found, taskId, contextId);
          contextId = found.contextId;
        }
        if (contextId) {
          return this.contexts.withLock(
            executionKey(this.storageEndpoint(url), contextId),
            signal,
            () =>
              this.send(
                message,
                url,
                key,
                contextId,
                taskId,
                signal,
                details,
                binding,
                deadline,
              ),
          );
        }
        return this.send(
          message,
          url,
          key,
          undefined,
          taskId,
          signal,
          details,
          binding,
          deadline,
        );
      });
    });
  }

  private async send(
    message: Message,
    url: string,
    key: string,
    contextId: string | undefined,
    taskId: string | undefined,
    signal: AbortSignal,
    details: A2AInvocationErrorDetails,
    binding: RecordState,
    deadline: number,
  ): Promise<Task | Message> {
    let record = contextId
      ? await this.load(executionKey(this.storageEndpoint(url), contextId))
      : {};
    // The binding is also a recovery journal if a process died between the two writes.
    if (
      contextId === binding.contextId &&
      ((binding.pending && !record.pending) ||
        (binding.taskId &&
          binding.messageId === record.messageId &&
          (!record.taskId ||
            (record.submissionUnknown && !binding.submissionUnknown))))
    )
      record = binding;
    this.requireReadback(record);
    if (record.taskId && !terminal(record.state)) {
      signal.throwIfAborted();
      const current = await this.invoker.getTask(url, record.taskId, signal);
      this.check(current, record.taskId, contextId);
      record = this.snapshot(current, record.messageId);
      await this.save(
        executionKey(this.storageEndpoint(url), contextId!),
        record,
      );
      if (
        !terminal(record.state) &&
        !(interrupted(record.state) && taskId === record.taskId)
      ) {
        throw new Error(
          interrupted(record.state)
            ? `A2A task ${record.taskId} requires same-task followup; supply task_id.`
            : `A2A task ${record.taskId} is still working or unresolved; use task get/cancel before sending again.`,
        );
      }
    }
    if (taskId) {
      signal.throwIfAborted();
      const current = await this.invoker.getTask(url, taskId, signal);
      this.check(current, taskId, contextId);
      if (terminal(current.status?.state))
        throw new Error(`Cannot continue terminal A2A task ${taskId}`);
      if (!interrupted(current.status?.state))
        throw new Error(`A2A task ${taskId} is still working or unresolved`);
    }

    const previous = record;
    record = {
      contextId,
      taskId,
      messageId: message.messageId,
      pending: true,
      submissionUnknown: true,
    };
    details.messageId = message.messageId;
    // Journal before submission, including first sends with no remote readback ID.
    await this.save(key, record);
    if (contextId)
      await this.save(
        executionKey(this.storageEndpoint(url), contextId),
        record,
      );
    let accepted: Task | undefined;
    let releaseContext: (() => void) | undefined;
    let contextLease: Promise<void> | undefined;
    let lockedContext = contextId;

    let persistence = Promise.resolve();
    let callbacksOpen = true;
    let acceptanceObserved = false;
    const writeTask = async (task: Task, acceptance: boolean) => {
      this.check(
        task,
        accepted?.id ?? taskId,
        contextId ?? accepted?.contextId,
      );
      accepted = task;
      details.task = task;
      acceptanceObserved ||= acceptance;
      record = {
        ...this.snapshot(task, message.messageId),
        submissionUnknown: !acceptanceObserved,
      };
      // Save readback IDs immediately, before waiting for the newly learned context.
      await this.save(key, record);
      if (!lockedContext) {
        let ready!: () => void;
        let failed!: (error: unknown) => void;
        const acquired = new Promise<void>((resolve, reject) => {
          ready = resolve;
          failed = reject;
        });
        const hold = new Promise<void>((resolve) => {
          releaseContext = resolve;
        });
        contextLease = this.contexts.withLock(
          executionKey(this.storageEndpoint(url), task.contextId),
          signal,
          async () => {
            lockedContext = task.contextId;
            ready();
            await hold;
          },
        );
        void contextLease.catch(failed);
        await acquired;
      }
      await this.save(
        executionKey(this.storageEndpoint(url), task.contextId),
        record,
      );
    };
    // The core may stop awaiting a started hook when aborted. Keep every write
    // in our own queue: recovery and lock release must outlive those callbacks.
    const persistTask = (task: Task, acceptance = false): Promise<void> => {
      const update = persistence.then(() => writeTask(task, acceptance));
      persistence = update.catch(() => undefined);
      return update;
    };
    const onTask = (task: Task): Promise<void> => {
      if (!callbacksOpen)
        return Promise.reject(
          new Error(
            "A2A acceptance callback arrived after invocation settlement",
          ),
        );
      return persistTask(task, true);
    };

    try {
      signal.throwIfAborted();
      details.submissionAttempted = true;
      const result = await this.invoker.invoke({
        url,
        message,
        contextId,
        taskId,
        signal,
        deadline,
        onTask,
      });
      callbacksOpen = false;
      await persistence;
      if ("messageId" in result) {
        if (
          (contextId && result.contextId !== contextId) ||
          (taskId && result.taskId !== taskId)
        )
          throw new Error("A2A message response identity mismatch");
        const completed: RecordState = {
          contextId: result.contextId || contextId,
          pending: false,
        };
        // A Message is a completed response, not a fabricated Task snapshot.
        await this.save(key, completed);
        if (completed.contextId) {
          if (lockedContext)
            await this.save(
              executionKey(this.storageEndpoint(url), completed.contextId),
              completed,
            );
          else
            await this.contexts.withLock(
              executionKey(this.storageEndpoint(url), completed.contextId),
              signal,
              () =>
                this.save(
                  executionKey(this.storageEndpoint(url), completed.contextId!),
                  completed,
                ),
            );
        }
      } else await persistTask(result, true);
      return result;
    } catch (error) {
      callbacksOpen = false;
      await persistence;
      if (error instanceof A2AInvocationError) {
        // Only typed readback, never a successful HTTP cancellation request alone.
        if (error.task) await persistTask(error.task);
        if (error.cancellation) await persistTask(error.cancellation);
        if (!error.submissionAttempted && !accepted) {
          await this.save(key, binding);
          if (contextId)
            await this.save(
              executionKey(this.storageEndpoint(url), contextId),
              previous,
            );
        }
        const failure = {
          ...details,
          submissionAttempted: error.submissionAttempted,
          messageId: error.messageId ?? details.messageId,
          task: accepted ?? error.task,
          cancellation: error.cancellation,
          cause: error,
        };
        throw error instanceof A2AInvocationCancelledError
          ? new A2AInvocationCancelledError(failure)
          : new A2AInvocationError(error.message, failure);
      }
      throw new A2AInvocationError(
        error instanceof Error ? error.message : "A2A invocation failed",
        { ...details, cause: error },
      );
    } finally {
      callbacksOpen = false;
      await persistence;
      releaseContext?.();
      await contextLease?.catch(() => undefined);
    }
  }

  private endpoint(target: string): string {
    const route = Object.hasOwn(this.routes, target)
      ? this.routes[target]
      : undefined;
    if (!route)
      throw new Error(
        `Unknown A2A target ${JSON.stringify(target)}. Configured targets: ${this.targets().join(", ")}`,
      );
    const url = new URL(route);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error("A2A endpoint must use HTTP(S)");
    if (url.username || url.password)
      throw new Error("A2A endpoint must not contain credentials");
    url.hash = "";
    return url.href;
  }

  private async load(key: string): Promise<RecordState> {
    const value = await this.contexts.get(key);
    if (value === undefined) return {};
    const record: unknown = JSON.parse(value);
    if (!record || typeof record !== "object" || Array.isArray(record))
      throw new Error(
        "Invalid A2A controller record; inspect the context store before retrying",
      );
    const fields = record as Record<string, unknown>;
    if (
      ["contextId", "taskId", "messageId"].some(
        (name) =>
          fields[name] !== undefined && typeof fields[name] !== "string",
      ) ||
      (fields.pending !== undefined && typeof fields.pending !== "boolean") ||
      (fields.submissionUnknown !== undefined &&
        typeof fields.submissionUnknown !== "boolean") ||
      (fields.state !== undefined &&
        (typeof fields.state !== "number" ||
          !Object.values(TaskState).includes(fields.state)))
    ) {
      throw new Error(
        "Invalid A2A controller metadata; inspect the context store before retrying",
      );
    }
    return record as RecordState;
  }

  private save(key: string, record: RecordState): Promise<void> {
    return this.contexts.set(key, JSON.stringify(record));
  }

  private requireReadback(record: RecordState): void {
    if (
      record.submissionUnknown ||
      (record.pending && (!record.taskId || record.state === undefined))
    ) {
      throw new A2AInvocationError(
        `Unknown A2A submission ${record.messageId ?? "(missing message ID)"}${record.taskId ? ` for task ${record.taskId}` : " has no task readback ID"}. Do not retry automatically or erase it with new_context. An unchanged task state does not acknowledge this message. Have the peer/operator correlate this exact message ID and explicitly reconcile the controller record before retrying.`,
        { submissionAttempted: false, messageId: record.messageId },
      );
    }
  }

  private snapshot(task: Task, messageId?: string): RecordState {
    return {
      contextId: task.contextId,
      taskId: task.id,
      state: task.status?.state,
      messageId,
      pending: !terminal(task.status?.state),
    };
  }

  private check(task: Task, taskId?: string, contextId?: string): void {
    if (
      !task.id ||
      !task.contextId ||
      (taskId && task.id !== taskId) ||
      (contextId && task.contextId !== contextId)
    ) {
      throw new Error("A2A task/context identity mismatch in remote readback");
    }
  }

  /** Deadline includes storage/discovery. Detached work retains its locks until settled. */
  private async operation<T>(
    caller: AbortSignal | undefined,
    details: Partial<A2AInvocationErrorDetails>,
    work: (signal: AbortSignal, deadline: number) => Promise<T>,
  ): Promise<T> {
    const deadline = performance.now() + this.timeoutMs;
    const controller = new AbortController();
    const relay = () =>
      controller.abort(
        caller?.aborted ? caller.reason : this.closed.signal.reason,
      );
    const sources = [caller, this.closed.signal].filter(
      (s): s is AbortSignal => !!s,
    );
    for (const source of sources) {
      source.addEventListener("abort", relay, { once: true });
      if (source.aborted) relay();
    }
    const timer = setTimeout(
      () => controller.abort(new Error("A2A operation timed out")),
      this.timeoutMs,
    );
    let abort!: () => void;
    const canceled = new Promise<never>((_, reject) => {
      abort = () => {
        const context = {
          submissionAttempted: false,
          ...details,
          cause: controller.signal.reason,
        };
        reject(
          caller?.aborted || this.closed.signal.aborted
            ? new A2AInvocationCancelledError(context)
            : new A2AInvocationError("A2A operation timed out", context),
        );
      };
      controller.signal.addEventListener("abort", abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    const pending = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return work(controller.signal, deadline);
    });
    if (caller) {
      const owned = this.owners.get(caller) ?? new Set<Promise<unknown>>();
      this.owners.set(caller, owned);
      owned.add(pending);
      const settled = () => {
        owned.delete(pending);
        if (owned.size === 0) this.owners.delete(caller);
      };
      void pending.then(settled, settled);
    }
    try {
      return await Promise.race([canceled, pending]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
      for (const source of sources) source.removeEventListener("abort", relay);
    }
  }
}
