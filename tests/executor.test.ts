import { describe, expect, test } from "bun:test";
import { TaskState } from "@a2a-js/sdk";

import { LettaAgentExecutor } from "../services/bridge/src/executor.js";
import { LettaTurnCancelledError } from "../services/bridge/src/letta-runtime.js";

describe("LettaAgentExecutor streaming artifacts", () => {
  test("publishes ordered assistant chunks before completion", async () => {
    const events: any[] = [];
    const runtime = {
      runTurn: async (options: {
        onAssistantDelta?: (text: string) => void;
      }) => {
        options.onAssistantDelta?.("SAFE_");
        options.onAssistantDelta?.("STREAM");
        return "SAFE_STREAM";
      },
      claimTerminal: () => "completed",
      cancelTask: async () => undefined,
    };
    const executor = new LettaAgentExecutor(runtime as never);

    await executor.execute(
      {
        taskId: "task-1",
        contextId: "context-1",
        task: undefined,
        userMessage: {
          messageId: "message-1",
          parts: [{ content: { $case: "text", value: "hello" } }],
          metadata: {},
        },
        request: { configuration: { returnImmediately: true } },
      } as never,
      { publish: (event: unknown) => events.push(event) } as never,
    );

    expect(events.map((event) => event.kind)).toEqual([
      "task",
      "statusUpdate",
      "artifactUpdate",
      "artifactUpdate",
      "statusUpdate",
    ]);
    const chunks = events
      .filter((event) => event.kind === "artifactUpdate")
      .map((event) => event.data);
    expect(
      chunks.map((chunk) => chunk.artifact.parts[0].content.value),
    ).toEqual(["SAFE_", "STREAM"]);
    expect(chunks.map((chunk) => chunk.append)).toEqual([false, true]);
    expect(chunks.map((chunk) => chunk.lastChunk)).toEqual([false, true]);
    expect(new Set(chunks.map((chunk) => chunk.artifact.artifactId)).size).toBe(1);
    expect(events.at(-1).data.status.state).toBe(
      TaskState.TASK_STATE_COMPLETED,
    );
  });

  test("never marks partial output final when the turn fails", async () => {
    const events: any[] = [];
    const runtime = {
      runTurn: async (options: {
        onAssistantDelta?: (text: string) => void;
      }) => {
        options.onAssistantDelta?.("PARTIAL_");
        options.onAssistantDelta?.("OUTPUT");
        throw new Error("runtime failed");
      },
      claimTerminal: () => "failed",
      cancelTask: async () => undefined,
    };
    const executor = new LettaAgentExecutor(runtime as never);

    await executor.execute(
      {
        taskId: "task-failed",
        contextId: "context-failed",
        task: undefined,
        userMessage: {
          messageId: "message-failed",
          parts: [{ content: { $case: "text", value: "hello" } }],
          metadata: {},
        },
        request: { configuration: { returnImmediately: true } },
      } as never,
      { publish: (event: unknown) => events.push(event) } as never,
    );

    const artifacts = events.filter((event) => event.kind === "artifactUpdate");
    expect(artifacts).toHaveLength(2);
    expect(artifacts.every((event) => event.data.lastChunk === false)).toBe(true);
    expect(
      artifacts.map((event) => event.data.artifact.parts[0].content.value),
    ).toEqual(["PARTIAL_", "OUTPUT"]);
    expect(events.at(-1).data.status.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(events.at(-1).data.status.message.parts[0].content.value).toBe(
      "Letta turn failed",
    );
  });

  test("leaves every partial chunk non-final when canceled", async () => {
    const events: any[] = [];
    const runtime = {
      runTurn: async (options: {
        onAssistantDelta?: (text: string) => void;
      }) => {
        options.onAssistantDelta?.("PARTIAL_");
        options.onAssistantDelta?.("CANCELED");
        throw new LettaTurnCancelledError();
      },
      claimTerminal: () => "canceled",
      cancelTask: async () => undefined,
    };
    const executor = new LettaAgentExecutor(runtime as never);

    await executor.execute(
      {
        taskId: "task-canceled",
        contextId: "context-canceled",
        task: undefined,
        userMessage: {
          messageId: "message-canceled",
          parts: [{ content: { $case: "text", value: "hello" } }],
          metadata: {},
        },
        request: { configuration: { returnImmediately: true } },
      } as never,
      { publish: (event: unknown) => events.push(event) } as never,
    );

    const artifacts = events.filter((event) => event.kind === "artifactUpdate");
    expect(artifacts).toHaveLength(2);
    expect(artifacts.every((event) => event.data.lastChunk === false)).toBe(true);
    expect(events.at(-1).data.status.state).toBe(TaskState.TASK_STATE_CANCELED);
  });
});
