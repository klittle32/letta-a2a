import { type Task, TaskState } from "@a2a-js/sdk";
import { UnsupportedOperationError } from "@a2a-js/sdk/errors";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { agentMessage, readText, textPart } from "./a2a-text.js";
import { trustedCaller } from "./request-policy.js";
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
    { contextId: string; bus: ExecutionEventBus }
  >();
  isActive(taskId: string): boolean {
    return this.activeTasks.has(taskId);
  }
  canResume(taskId: string): boolean {
    return (
      !this.stopped && this.interrupted.has(taskId) && !this.isActive(taskId)
    );
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
  ) {
    if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs < 0)
      throw new Error("Invalid shutdown timeout");
  }

  execute(request: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
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
    try {
      this.publishTaskStarted(request, eventBus);
      if (this.stopped) throw new Error("Bridge is closed");
      const modes = request.request.configuration?.acceptedOutputModes;
      if (modes?.length && !modes.includes("text/plain"))
        throw new Error("Only text/plain output is supported");
      const text = readText(userMessage).trim();
      if (!text) throw new Error("The A2A message must contain text");
      const result = await this.letta.runTurn({
        a2aContextId: JSON.stringify([
          request.context.user?.userName ?? "",
          request.context.tenant ?? "",
          contextId,
        ]),
        protocolContextId: contextId,
        caller: trustedCaller(request.context),
        messageId: userMessage.messageId,
        text,
        signal: cancellation.signal,
        onAssistantText: (chunk) => artifact.push(chunk),
      });
      if (cancellation.signal.aborted) {
        artifact.stop();
        this.publishTerminal(
          eventBus,
          taskId,
          contextId,
          TaskState.TASK_STATE_CANCELED,
        );
      } else {
        artifact.finish(result.text);
        this.publishTerminal(
          eventBus,
          taskId,
          contextId,
          result.state === "input_required"
            ? TaskState.TASK_STATE_INPUT_REQUIRED
            : result.state === "auth_required"
              ? TaskState.TASK_STATE_AUTH_REQUIRED
              : TaskState.TASK_STATE_COMPLETED,
          result.detail,
        );
        if (
          result.state === "input_required" ||
          result.state === "auth_required"
        ) {
          this.interrupted.set(taskId, { contextId, bus: eventBus });
          // SDK 1.1.0 AUTH_REQUIRED queues intentionally stay open for in-flight
          // credential injection. Our explicit outcome instead means the runner
          // has settled. Finish this execution's queues (not its wire task), so
          // no stale ResultManager drains a future same-task turn. The SDK keeps
          // the interrupted task's reusable bus registered for resubscription.
          eventBus.finished();
        }
      }
    } catch (error) {
      try {
        void Promise.resolve(this.onError?.({ taskId, error })).catch(
          () => undefined,
        );
      } catch {
        /* Diagnostics cannot alter task lifecycle. */
      }
      artifact.stop();
      // Only a completed runner or explicit cancellation outcome confirms stop.
      if (error instanceof LettaTurnCancelledError) {
        this.publishTerminal(
          eventBus,
          taskId,
          contextId,
          TaskState.TASK_STATE_CANCELED,
        );
      } else {
        this.publishTerminal(
          eventBus,
          taskId,
          contextId,
          TaskState.TASK_STATE_FAILED,
          "The bridge could not complete this text request",
        );
      }
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
      this.publishTerminal(
        interrupted.bus,
        taskId,
        interrupted.contextId,
        TaskState.TASK_STATE_CANCELED,
      );
      interrupted.bus.finished();
    }
  }

  close(): Promise<CloseResult> {
    if (this.closing) return this.closing;
    this.stopped = true;
    for (const { bus } of this.interrupted.values()) bus.finished();
    this.closing = this.drain();
    return this.closing;
  }
  private async drain(): Promise<CloseResult> {
    for (const cancellation of this.activeTasks.values()) cancellation.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...this.executions]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.shutdownTimeoutMs);
      }),
    ]);
    clearTimeout(timer);
    const pendingTaskIds = [...this.activeTasks.keys()];
    const unresolvedContextIds = [...(this.letta.unresolvedContexts ?? [])];
    return {
      complete:
        this.executions.size === 0 &&
        pendingTaskIds.length === 0 &&
        unresolvedContextIds.length === 0,
      pendingTaskIds,
      unresolvedContextIds,
    };
  }

  private publishTaskStarted(
    request: RequestContext,
    eventBus: ExecutionEventBus,
  ): void {
    const snapshot: Task = request.task ?? {
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
    };
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
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state,
          timestamp: new Date().toISOString(),
          message: detail ? agentMessage(detail, taskId, contextId) : undefined,
        },
        metadata: undefined,
      }),
    );
  }
}

/** One-item lookahead preserves nonfinal partial output on failure/cancellation. */
class StreamingTextArtifact {
  private readonly artifactId = crypto.randomUUID();
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
  }
  finish(fallback: string): void {
    if (this.pending === undefined && !this.started && fallback)
      this.pending = fallback;
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
