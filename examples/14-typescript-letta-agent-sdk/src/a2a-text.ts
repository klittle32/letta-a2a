import { type Message, Role } from "@a2a-js/sdk";

export function readText(message: Message): string {
  return message.parts
    .flatMap((part) =>
      part.content?.$case === "text" ? [part.content.value] : [],
    )
    .join("");
}

export function agentMessage(
  text: string,
  taskId: string,
  contextId: string,
): Message {
  return {
    role: Role.ROLE_AGENT,
    messageId: crypto.randomUUID(),
    taskId,
    contextId,
    parts: [textPart(text)],
    extensions: [],
    metadata: undefined,
    referenceTaskIds: [],
  };
}

export function textPart(text: string) {
  return {
    content: { $case: "text" as const, value: text },
    metadata: undefined,
    filename: "",
    mediaType: "text/plain",
  };
}
