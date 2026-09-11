import { randomUUID } from "node:crypto";

import { type Message, Role, TaskState } from "@a2a-js/sdk";
import { createA2AClient } from "letta-a2a-client";

import { readText, textPart } from "letta-a2a-bridge";

const { contextId, text } = parseArguments(process.argv.slice(2));
const baseUrl = (process.env.A2A_BASE_URL ?? "http://127.0.0.1:41241").replace(
  /\/$/,
  "",
);

const outbound = createA2AClient({ routes: { bridge: baseUrl } });
const signal = AbortSignal.timeout(120_000);
const client = await outbound.connect("bridge", signal);

const message: Message = {
  role: Role.ROLE_USER,
  messageId: randomUUID(),
  contextId: contextId ?? "",
  taskId: "",
  parts: [textPart(text)],
  extensions: [],
  metadata: undefined,
  referenceTaskIds: [],
};

let observedContextId = contextId;
let observedTaskId: string | undefined;
let wroteText = false;
let responseLineClosed = false;

for await (const response of client.sendMessageStream(
  {
    tenant: "",
    message,
    configuration: {
      acceptedOutputModes: ["text/plain"],
      taskPushNotificationConfig: undefined,
      returnImmediately: false,
    },
    metadata: undefined,
  },
  { signal },
)) {
  const payload = response.payload;
  if (!payload) continue;

  if (payload.$case === "task") {
    observedTaskId = payload.value.id;
    observedContextId = payload.value.contextId;
  } else if (payload.$case === "statusUpdate") {
    observedTaskId = payload.value.taskId;
    observedContextId = payload.value.contextId;
    if (wroteText && !responseLineClosed) {
      process.stdout.write("\n");
      responseLineClosed = true;
    }
    console.error(`state=${TaskState[payload.value.status?.state ?? 0]}`);
  } else if (payload.$case === "artifactUpdate") {
    observedTaskId = payload.value.taskId;
    observedContextId = payload.value.contextId;
    for (const part of payload.value.artifact?.parts ?? []) {
      if (part.content?.$case === "text") {
        process.stdout.write(part.content.value);
        wroteText = true;
        responseLineClosed = false;
      }
    }
  } else if (payload.$case === "message") {
    observedTaskId = payload.value.taskId || observedTaskId;
    observedContextId = payload.value.contextId || observedContextId;
    const output = readText(payload.value);
    if (output) {
      process.stdout.write(output);
      wroteText = true;
      responseLineClosed = false;
    }
  }
}

if (wroteText && !responseLineClosed) process.stdout.write("\n");
console.log(`taskId=${observedTaskId ?? "(none)"}`);
console.log(`contextId=${observedContextId ?? "(none)"}`);
outbound.close();

function parseArguments(args: string[]): {
  contextId?: string;
  text: string;
} {
  let contextId: string | undefined;
  if (args[0] === "--context") {
    contextId = args[1]?.trim();
    args = args.slice(2);
    if (!contextId) throw usage("--context requires an A2A context ID");
  }

  const text = args.join(" ").trim();
  if (!text) throw usage("Provide a message to send");
  return { contextId, text };
}

function usage(message: string): Error {
  return new Error(
    `${message}\nUsage: bun run ask -- [--context <context-id>] <message>`,
  );
}
