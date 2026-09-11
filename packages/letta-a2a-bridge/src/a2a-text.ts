import { Role, type Message } from "@a2a-js/sdk";

export function readText(message: Message): string {
  return message.parts
    .map((part) => {
      if (part.content?.$case !== "text")
        throw new Error("Only text parts are supported by this bridge");
      return part.content.value;
    })
    .join("");
}
export function textPart(text: string) {
  return {
    content: { $case: "text" as const, value: text },
    metadata: undefined,
    filename: "",
    mediaType: "text/plain",
  };
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
