import { expect, test } from "bun:test";
import {
  SendMessageRequest,
  TaskState,
  type StreamResponse,
} from "@a2a-js/sdk";
import { ServerCallContext } from "@a2a-js/sdk/server";
import { createBridge, LettaTurnCancelledError } from "../src/index.js";

test("canceled streaming output never marks a partial artifact final", async () => {
  const bridge = createBridge({
    sharingDomain: "partial-cancel",
    publicBaseUrl: "http://localhost",
    runner: {
      async runTurn(request) {
        request.onAssistantText("PARTIAL_");
        request.onAssistantText("OUTPUT");
        await new Promise<void>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(new LettaTurnCancelledError()),
            { once: true },
          );
        });
        return { text: "unreachable" };
      },
    },
  });
  const context = new ServerCallContext({ requestedVersion: "1.0" });
  const stream = bridge.requestHandler.sendMessageStream(
    SendMessageRequest.fromJSON({
      message: {
        messageId: "message",
        role: "ROLE_USER",
        parts: [{ text: "run" }],
      },
    }),
    context,
  );
  const events: StreamResponse[] = [];
  try {
    const first = await stream.next();
    if (first.value?.payload?.$case !== "task")
      throw new Error("Expected task snapshot");
    const id = first.value.payload.value.id;
    let partial!: () => void;
    const ready = new Promise<void>((resolve) => {
      partial = resolve;
    });
    const drain = (async () => {
      for await (const event of stream) {
        events.push(event);
        if (event.payload?.$case === "artifactUpdate") partial();
      }
    })();
    await ready;
    await bridge.requestHandler.cancelTask(
      { id, tenant: "", metadata: undefined },
      context,
    );
    await drain;
    const artifacts = events.flatMap((event) =>
      event.payload?.$case === "artifactUpdate" ? [event.payload.value] : [],
    );
    expect(artifacts.length).toBeGreaterThan(0);
    expect(artifacts.every((event) => !event.lastChunk)).toBe(true);
    expect(
      events.some(
        (event) =>
          event.payload?.$case === "statusUpdate" &&
          event.payload.value.status?.state === TaskState.TASK_STATE_CANCELED,
      ),
    ).toBe(true);
  } finally {
    await bridge.close();
  }
});
