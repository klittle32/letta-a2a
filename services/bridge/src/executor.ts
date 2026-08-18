import { randomUUID } from "node:crypto";

import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import {
  Role,
  type Task,
  TaskState,
} from "@a2a-js/sdk";

import { LettaRuntime, LettaTurnCancelledError } from "./letta-runtime.js";
import { extractMessageText } from "./mapping.js";
import {
  assertDelegationRequestIsAsync,
  extractA2AHop,
} from "./delegation-policy.js";

export class LettaAgentExecutor implements AgentExecutor {
  constructor(private readonly runtime: LettaRuntime) {}

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;
    const existingTask = requestContext.task;
    const userMessage = requestContext.userMessage;

    const snapshot: Task = existingTask ?? {
      id: taskId,
      contextId,
      status: {
        state: TaskState.TASK_STATE_SUBMITTED,
        timestamp: new Date().toISOString(),
        message: undefined,
      },
      artifacts: [],
      history: [userMessage],
      metadata: userMessage.metadata,
    };
    eventBus.publish(AgentEvent.task(snapshot));
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_WORKING,
          timestamp: new Date().toISOString(),
          message: undefined,
        },
        metadata: {},
      }),
    );

    try {
      const text = extractMessageText(userMessage).trim();
      if (!text) throw new Error("A2A message must contain a text part");
      assertDelegationRequestIsAsync(
        text,
        requestContext.request.configuration?.returnImmediately === true,
      );

      const response = await this.runtime.runTurn({
        a2aContextId: contextId,
        a2aTaskId: taskId,
        messageId: userMessage.messageId,
        text,
        hop: extractA2AHop(requestContext.request.metadata),
      });

      eventBus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact: {
            artifactId: randomUUID(),
            name: "Letta response",
            description: "Final text returned by the delegated Letta turn.",
            parts: [
              {
                content: { $case: "text", value: response },
                metadata: undefined,
                filename: "",
                mediaType: "text/plain",
              },
            ],
            metadata: undefined,
            extensions: [],
          },
          append: false,
          lastChunk: true,
          metadata: {},
        }),
      );
      this.publishTerminal(eventBus, taskId, contextId, TaskState.TASK_STATE_COMPLETED);
    } catch (error) {
      if (error instanceof LettaTurnCancelledError) {
        this.publishTerminal(eventBus, taskId, contextId, TaskState.TASK_STATE_CANCELED);
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_FAILED,
            timestamp: new Date().toISOString(),
            message: {
              role: Role.ROLE_AGENT,
              messageId: randomUUID(),
              parts: [
                {
                  content: { $case: "text", value: message },
                  metadata: undefined,
                  filename: "",
                  mediaType: "text/plain",
                },
              ],
              taskId,
              contextId,
              extensions: [],
              metadata: {},
              referenceTaskIds: [],
            },
          },
          metadata: {},
        }),
      );
    }
  }

  async cancelTask(
    taskId: string,
    _eventBus: ExecutionEventBus,
  ): Promise<void> {
    await this.runtime.cancelTask(taskId);
  }

  private publishTerminal(
    eventBus: ExecutionEventBus,
    taskId: string,
    contextId: string,
    state: TaskState,
  ): void {
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state,
          timestamp: new Date().toISOString(),
          message: undefined,
        },
        metadata: {},
      }),
    );
  }
}
