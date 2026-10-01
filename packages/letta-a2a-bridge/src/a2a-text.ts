import { Role, type Message, type Part, type Task } from "@a2a-js/sdk";

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

/**
 * Joins adjacent plain text parts in each artifact. Streaming appends one part
 * per delta; readers of a stored task (GetTask, blocking SendMessage) should get
 * whole text, which some clients would otherwise render with separators.
 */
export function coalesceTextParts(task: Task): Task {
  if (!task.artifacts?.length) return task;
  return {
    ...task,
    artifacts: task.artifacts.map((artifact) => {
      const parts: Part[] = [];
      for (const part of artifact.parts) {
        const previous = parts.at(-1);
        if (
          previous?.content?.$case === "text" &&
          part.content?.$case === "text" &&
          mergeable(previous, part)
        ) {
          parts[parts.length - 1] = {
            ...previous,
            content: { $case: "text", value: previous.content.value + part.content.value },
          };
        } else parts.push(part);
      }
      return { ...artifact, parts };
    }),
  };
}

function mergeable(a: Part, b: Part): boolean {
  return (
    a.metadata === undefined &&
    b.metadata === undefined &&
    a.filename === b.filename &&
    a.mediaType === b.mediaType
  );
}
