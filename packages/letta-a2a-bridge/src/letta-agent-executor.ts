import { type Task, TaskState } from "@a2a-js/sdk";
import { UnsupportedOperationError } from "@a2a-js/sdk/errors";
import {
  AgentEvent,
  resolveUserScope,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { agentMessage, readText, textPart } from "./a2a-text.js";
import { trustedCaller } from "./request-policy.js";
import type { DurableBinding } from "./durable-binding.js";
import {
  LettaTurnCancelledError,
  type LettaTurnRunner,
} from "./letta-agent.js";

export interface CloseResult {
  complete: boolean;
  pendingTaskIds: string[];
  unresolvedContextIds: string[];
}

/** A2A SDK owns task storage and transport; this executor only translates turns. */
export class LettaAgentExecutor implements AgentExecutor {
  private readonly activeTasks = new Map<string, AbortController>();
  private readonly executions = new Set<Promise<void>>();
  private readonly interrupted = new Map<
    string,
    { contextId: string; bus: ExecutionEventBus; request: RequestContext }
  >();
  isActive(taskId: string): boolean {
    return this.activeTasks.has(taskId);
  }
  canResume(taskId: string): boolean {
    return (
      !this.stopped && this.interrupted.has(taskId) && !this.isActive(taskId)
    );
  }
  private readonly finalizationFailures = new Set<string>();
  private contextKey(request: RequestContext): string {
    return JSON.stringify([
      this.durability
        ? resolveUserScope(request.context)
        : (request.context.user?.userName ?? ""),
      request.context.tenant ?? "",
      request.contextId,
    ]);
  }
  private report(taskId: string, error: unknown): void {
    try {
      void Promise.resolve(this.onError?.({ taskId, error })).catch(
        () => undefined,
      );
    } catch {
      /* Diagnostics cannot alter lifecycle. */
    }
  }
  private closing?: Promise<CloseResult>;
  private stopped = false;
  constructor(
    private readonly letta: LettaTurnRunner,
    private readonly shutdownTimeoutMs = 5_000,
    private readonly onError?: (event: {
      taskId: string;
      error: unknown;
    }) => void | Promise<void>,
    private readonly durability?: DurableBinding,
  ) {
    if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs < 0)
      throw new Error("Invalid shutdown timeout");
  }

  execute(request: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    if (this.stopped) {
      // The SDK may still persist its synthetic rejection. Keep the durable
      // owner if that late consumer cannot be accounted for by the closed facade.
      if (this.durability)
        this.finalizationFailures.add(this.contextKey(request));
      return Promise.reject(new UnsupportedOperationError("Bridge is closed"));
    }
    if (this.activeTasks.has(request.taskId)) {
      return Promise.reject(
        new UnsupportedOperationError("Task execution is already active"),
      );
    }
    const execution = this.executeTurn(request, eventBus);
    this.executions.add(execution);
    void execution.then(
      () => this.executions.delete(execution),
      () => this.executions.delete(execution),
    );
    return execution;
  }

  private async executeTurn(
    request: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const { taskId, contextId, userMessage } = request;
    const cancellation = new AbortController();
    this.activeTasks.set(taskId, cancellation);
    this.interrupted.delete(taskId);
    const artifact = new StreamingTextArtifact(eventBus, taskId, contextId);
    const contextKey = this.contextKey(request);
    let accepted = false;
    try {
      const initial = this.initialTask(request);
      if (this.durability)
        await this.durability.accept(request, initial, artifact.artifactId);
      accepted = true;
      this.publishTaskStarted(request, eventBus, initial);
      let state = TaskState.TASK_STATE_FAILED;
      let detail: string | undefined;
      let confirmedStopped = false;
      let successful = false;
      try {
        if (this.stopped) throw new Error("Bridge is closed");
        const modes = request.request.configuration?.acceptedOutputModes;
        if (modes?.length && !modes.includes("text/plain"))
          throw new Error("Only text/plain output is supported");
        const text = readText(userMessage).trim();
        if (!text) throw new Error("The A2A message must contain text");
        if (this.durability) await this.durability.dispatched(request);
        const result = await this.letta.runTurn({
          taskId,
          a2aContextId: contextKey,
          protocolContextId: contextId,
          caller: trustedCaller(request.context),
          messageId: userMessage.messageId,
          text,
          signal: cancellation.signal,
          onAssistantText: (chunk) => artifact.push(chunk),
        });
        if (this.letta.unresolvedContexts?.includes(contextKey))
          throw new Error("Execution requires reconciliation");
        confirmedStopped = true;
        state = cancellation.signal.aborted
          ? TaskState.TASK_STATE_CANCELED
          : result.state === "input_required"
            ? TaskState.TASK_STATE_INPUT_REQUIRED
            : result.state === "auth_required"
              ? TaskState.TASK_STATE_AUTH_REQUIRED
              : TaskState.TASK_STATE_COMPLETED;
        successful = !cancellation.signal.aborted;
        detail = result.detail;
        if (successful) artifact.prepare(result.text);
      } catch (error) {
        this.report(taskId, error);
        confirmedStopped =
          error instanceof LettaTurnCancelledError &&
          !this.letta.unresolvedContexts?.includes(contextKey);
        state = confirmedStopped
          ? TaskState.TASK_STATE_CANCELED
          : TaskState.TASK_STATE_FAILED;
        detail = confirmedStopped
          ? undefined
          : "The bridge could not complete this text request; execution may require reconciliation";
      }
      // One status message identity connects journal preparation to the SDK save.
      const terminal = this.terminalEvent(
        taskId,
        contextId,
        state,
        detail ??
          (this.durability
            ? state === TaskState.TASK_STATE_COMPLETED
              ? "Request completed"
              : "Request stopped or interrupted"
            : undefined),
      );
      if (this.durability) {
        const replacement = artifact.replacement(successful);
        await this.durability.publication(
          request,
          [...(replacement ? [replacement] : []), terminal],
          confirmedStopped,
        );
      }
      if (successful) artifact.finish();
      else artifact.stop();
      eventBus.publish(terminal);
      const interrupted =
        state === TaskState.TASK_STATE_INPUT_REQUIRED ||
        state === TaskState.TASK_STATE_AUTH_REQUIRED;
      // AUTH_REQUIRED queues otherwise stay open; this runner has actually settled.
      if (interrupted) eventBus.finished();
      if (this.durability) await this.durability.waitPublished(request);
      if (interrupted)
        this.interrupted.set(taskId, { contextId, bus: eventBus, request });
    } catch (error) {
      this.report(taskId, error);
      if (accepted && this.durability)
        this.finalizationFailures.add(contextKey);
      // The official handler synthesizes a bounded FAILED response, including a
      // first Task for streams. Never leak disk errors or retry final publication.
      throw new Error(
        "Bridge persistence failed; execution requires reconciliation",
      );
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  async cancelTask(
    taskId: string,
    _eventBus: ExecutionEventBus,
  ): Promise<void> {
    this.activeTasks.get(taskId)?.abort();
    const interrupted = this.interrupted.get(taskId);
    if (interrupted && !this.isActive(taskId)) {
      this.interrupted.delete(taskId);
      let releasePublication!: () => void;
      const publishing = new Promise<void>((resolve) => {
        releasePublication = resolve;
      });
      this.executions.add(publishing);
      this.activeTasks.set(taskId, new AbortController());
      try {
        const terminal = this.terminalEvent(
          taskId,
          interrupted.contextId,
          TaskState.TASK_STATE_CANCELED,
          this.durability ? "Request canceled" : undefined,
        );
        if (this.durability)
          await this.durability.publication(
            interrupted.request,
            [terminal],
            true,
          );
        interrupted.bus.publish(terminal);
        interrupted.bus.finished();
        if (this.durability) {
          // SDK cancelTask starts its ResultManager only AFTER this method returns.
          // Track the acknowledgment for close, but do not deadlock that consumer.
          this.activeTasks.set(taskId, new AbortController());
          const pending = this.durability
            .waitPublished(interrupted.request)
            .catch((error) => {
              this.report(taskId, error);
              this.finalizationFailures.add(
                this.contextKey(interrupted.request),
              );
            })
            .finally(() => {
              this.activeTasks.delete(taskId);
              this.executions.delete(pending);
            });
          this.executions.add(pending);
        } else this.activeTasks.delete(taskId);
      } catch (error) {
        this.activeTasks.delete(taskId);
        this.report(taskId, error);
        this.finalizationFailures.add(this.contextKey(interrupted.request));
        throw new Error(
          "Bridge persistence failed; execution requires reconciliation",
        );
      } finally {
        this.executions.delete(publishing);
        releasePublication();
      }
    }
  }

  close(): Promise<CloseResult> {
    if (this.closing) return this.closing;
    this.stopped = true;
    for (const { bus } of this.interrupted.values()) bus.finished();
    this.closing = this.drain();
    return this.closing;
  }
  recheckClose(timeoutMs: number): Promise<CloseResult> {
    if (!this.stopped)
      throw new Error("Close must begin before its final drain");
    return this.drain(timeoutMs);
  }
  private async drain(
    timeoutMs = this.shutdownTimeoutMs,
  ): Promise<CloseResult> {
    for (const cancellation of this.activeTasks.values()) cancellation.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...this.executions]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    const pendingTaskIds = [...this.activeTasks.keys()];
    const unresolvedContextIds = [
      ...new Set([
        ...(this.letta.unresolvedContexts ?? []),
        ...(this.durability?.unresolvedContexts ?? []),
        ...this.finalizationFailures,
      ]),
    ];
    return {
      complete:
        this.executions.size === 0 &&
        pendingTaskIds.length === 0 &&
        unresolvedContextIds.length === 0,
      pendingTaskIds,
      unresolvedContextIds,
    };
  }

  private initialTask(request: RequestContext): Task {
    return (
      request.task ?? {
        id: request.taskId,
        contextId: request.contextId,
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          timestamp: new Date().toISOString(),
          message: undefined,
        },
        artifacts: [],
        history: [request.userMessage],
        metadata: request.userMessage.metadata,
      }
    );
  }
  private publishTaskStarted(
    request: RequestContext,
    eventBus: ExecutionEventBus,
    snapshot: Task,
  ): void {
    eventBus.publish(AgentEvent.task(snapshot));
    this.publishTerminal(
      eventBus,
      request.taskId,
      request.contextId,
      TaskState.TASK_STATE_WORKING,
    );
  }
  private publishTerminal(
    eventBus: ExecutionEventBus,
    taskId: string,
    contextId: string,
    state: TaskState,
    detail?: string,
  ): void {
    eventBus.publish(this.terminalEvent(taskId, contextId, state, detail));
  }
  private terminalEvent(
    taskId: string,
    contextId: string,
    state: TaskState,
    detail?: string,
  ) {
    return AgentEvent.statusUpdate({
      taskId,
      contextId,
      status: {
        state,
        timestamp: new Date().toISOString(),
        message: detail ? agentMessage(detail, taskId, contextId) : undefined,
      },
      metadata: undefined,
    });
  }
}

/** One-item lookahead preserves nonfinal partial output on failure/cancellation. */
class StreamingTextArtifact {
  readonly artifactId = crypto.randomUUID();
  private readonly chunks: string[] = [];
  private pending?: string;
  private started = false;
  constructor(
    private readonly eventBus: ExecutionEventBus,
    private readonly taskId: string,
    private readonly contextId: string,
  ) {}
  push(text: string): void {
    if (!text) return;
    this.flush(false);
    this.pending = text;
    this.chunks.push(text);
  }
  prepare(fallback: string): void {
    if (this.pending === undefined && !this.started && fallback) {
      this.pending = fallback;
      this.chunks.push(fallback);
    }
  }
  replacement(lastChunk: boolean) {
    if (!this.chunks.length) return undefined;
    return AgentEvent.artifactUpdate({
      taskId: this.taskId,
      contextId: this.contextId,
      artifact: {
        artifactId: this.artifactId,
        name: "Letta response",
        description: "Public assistant text from the Letta turn.",
        parts: this.chunks.map(textPart),
        metadata: undefined,
        extensions: [],
      },
      append: false,
      lastChunk,
      metadata: undefined,
    });
  }
  finish(): void {
    this.flush(true);
  }
  stop(): void {
    this.flush(false);
  }
  private flush(lastChunk: boolean): void {
    if (this.pending === undefined) return;
    this.eventBus.publish(
      AgentEvent.artifactUpdate({
        taskId: this.taskId,
        contextId: this.contextId,
        artifact: {
          artifactId: this.artifactId,
          name: "Letta response",
          description: "Public assistant text from the Letta turn.",
          parts: [textPart(this.pending)],
          metadata: undefined,
          extensions: [],
        },
        append: this.started,
        lastChunk,
        metadata: undefined,
      }),
    );
    this.started = true;
    this.pending = undefined;
  }
}
