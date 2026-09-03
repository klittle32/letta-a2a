#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const target = process.argv[2] ?? "agent-a";
const baseUrl =
  process.env.A2A_GATEWAY_URL ?? "http://127.0.0.1:4000";
const apiKey = process.env.A2A_GATEWAY_KEY ?? "sk-a2a-lab-only";
const prompt =
  process.argv.slice(3).join(" ") ||
  "Reply briefly with your agent name and confirm that A2A reached you.";
const contextId = process.env.A2A_CONTEXT_ID?.trim();

const cardResponse = await fetch(
  `${baseUrl}/a2a/${encodeURIComponent(target)}/.well-known/agent-card.json`,
  { headers: { Authorization: `Bearer ${apiKey}` } },
);
if (!cardResponse.ok) {
  throw new Error(`Agent Card request failed: ${cardResponse.status} ${await cardResponse.text()}`);
}
const card = await cardResponse.json();

const request = {
  jsonrpc: "2.0",
  id: randomUUID(),
  method: "SendMessage",
  params: {
    message: {
      messageId: randomUUID(),
      ...(contextId ? { contextId } : {}),
      role: "ROLE_USER",
      parts: [{ text: prompt }],
    },
    configuration: { returnImmediately: true },
  },
};

let payload = await sendRpc(request);
let task = payload.result?.task;
const deadline = Date.now() + 120_000;
while (task && !isTerminal(task.status?.state)) {
  if (Date.now() >= deadline) {
    throw new Error(`Timed out polling A2A task ${task.id}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  payload = await sendRpc({
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "GetTask",
    params: { id: task.id },
  });
  task = payload.result?.task ?? payload.result;
  payload = { ...payload, result: { task } };
}
const taskState = payload.result?.task?.status?.state;
if (
  typeof taskState === "string" &&
  isTerminal(taskState) &&
  !taskState.endsWith("COMPLETED")
) {
  const failureText = payload.result.task.status.message?.parts
    ?.map((part) => part.text ?? part.content?.value ?? "")
    .join("");
  throw new Error(`A2A task failed: ${failureText || taskState}`);
}

const primaryInterface = card.supportedInterfaces?.find(
  (candidate) => candidate.protocolVersion === "1.0",
);

console.log(
  JSON.stringify(
    {
      agentCard: {
        name: card.name,
        version: card.version,
        protocolVersion: card.protocolVersion ?? primaryInterface?.protocolVersion,
        url: card.url ?? primaryInterface?.url,
      },
      result: payload.result,
    },
    null,
    2,
  ),
);

async function sendRpc(body) {
  const response = await fetch(`${baseUrl}/a2a/${encodeURIComponent(target)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "A2A-Version": "1.0",
    },
    body: JSON.stringify(body),
  });
  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`A2A invocation failed: ${response.status} ${rawBody}`);
  }
  const parsed = JSON.parse(rawBody);
  if (parsed.error) {
    throw new Error(`A2A error: ${JSON.stringify(parsed.error)}`);
  }
  return parsed;
}

function isTerminal(state) {
  return (
    typeof state === "string" &&
    ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].some((suffix) =>
      state.endsWith(suffix),
    )
  );
}
