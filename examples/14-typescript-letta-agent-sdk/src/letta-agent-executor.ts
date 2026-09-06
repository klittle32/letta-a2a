import {
  type Task,
  TaskState,
} from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";

import { agentMessage, readText, textPart } from "./a2a-text.js";
import {
  LettaTurnCancelledError,
  type LettaTurnRunner,
} from "./letta-agent.js";

/**
 * The complete A2A-to-Letta protocol adapter.
 *
 * The A2A SDK owns HTTP, JSON-RPC, task storage, and stream delivery. The
 * Letta Agent SDK owns agent sessions and turns. This executor is the narrow
 * seam between them: input text goes in, public assistant text comes out, and
 * cancellation crosses the boundary in both directions.
 */
export class LettaAgentExecutor implements AgentExecutor {
  private readonly activeTasks = new Map<string, AbortController>();

  constructor(private readonly letta: LettaTurnRunner) {}

  async execute(
    request: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const { taskId, contextId, userMessage } = request;
    const cancellation = new AbortController();
    this.activeTasks.set(taskId, cancellation);

    const artifact = new StreamingTextArtifact(eventBus, taskId, contextId);

    try {
      console.log(`[a2a] task=${taskId} context=${contextId} started`);
      // An executor publishes protocol events; it does not return the model's
      // answer from this method.
      this.publishTaskStarted(request, eventBus);

      const text = readText(userMessage).trim();
      if (!text) throw new Error("The A2A message must contain a text part");

      const result = await this.letta.runTurn({
        a2aContextId: contextId,
        messageId: userMessage.messageId,
        text,
        signal: cancellation.signal,
        onAssistantText: (chunk) => artifact.push(chunk),
      });

      if (cancellation.signal.aborted) {
        artifact.stop();
        this.publishTerminal(eventBus, taskId, contextId, TaskState.TASK_STATE_CANCELED);
        return;
      }

      artifact.finish(result.text);
      this.publishTerminal(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED);
    } catch (error) {
      artifact.stop();
      if (
        cancellation.signal.aborted ||
        error instanceof LettaTurnCancelledError
      ) {
        this.publishTerminal(eventBus, taskId, contextId, TaskState.TASK_STATE_CANCELED);
      } else {
        const detail = error instanceof Error ? error.message : String(error);
        this.publishTerminal(
          eventBus,
          taskId,
          contextId,
          TaskState.TASK_STATE_FAILED,
          detail,
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
    // The AbortSignal wakes a task waiting on its context lock and asks an
    // active Letta Agent SDK session to abort its current turn.
    this.activeTasks.get(taskId)?.abort();
  }

  close(): void {
    for (const cancellation of this.activeTasks.values()) cancellation.abort();
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
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId: request.taskId,
        contextId: request.contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          timestamp: new Date().toISOString(),
          message: undefined,
        },
        metadata: undefined,
      }),
    );
  }

  private publishTerminal(
    eventBus: ExecutionEventBus,
    taskId: string,
    contextId: string,
    state: TaskState,
    detail?: string,
  ): void {
    console.log(`[a2a] task=${taskId} state=${TaskState[state]}`);
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state,
          timestamp: new Date().toISOString(),
          message: detail
            ? agentMessage(detail, taskId, contextId)
            : undefined,
        },
        metadata: undefined,
      }),
    );
  }
}

/**
 * A one-item lookahead lets the final text chunk carry lastChunk=true without
 * buffering the whole response. Earlier chunks remain visible immediately.
 */
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
    if (this.pending === undefined && !this.started && fallback) {
      this.pending = fallback;
    }
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
