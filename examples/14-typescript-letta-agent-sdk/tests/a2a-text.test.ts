import { describe, expect, test } from "bun:test";
import type { Part } from "@a2a-js/sdk";

import { agentMessage, readText, textPart } from "letta-a2a-bridge";

describe("Example 14 text input", () => {
  test("preserves every text part in order", () => {
    const message = agentMessage("first", "task-1", "context-1");
    message.parts.push(textPart(" second"));

    expect(readText(message)).toBe("first second");
  });

  for (const content of [
    { $case: "data", value: { instruction: "do not discard" } },
    { $case: "url", value: "https://example.test/document.pdf" },
    { $case: "raw", value: Buffer.from([1, 2, 3]) },
    undefined,
  ] satisfies Array<Part["content"]>) {
    test(`rejects mixed text and ${content?.$case ?? "empty"} content`, () => {
      const message = agentMessage(
        "read the attachment",
        "task-1",
        "context-1",
      );
      message.parts.push({ ...textPart(""), content });

      expect(() => readText(message)).toThrow(
        "Only text parts are supported by this bridge",
      );
    });
  }
});
