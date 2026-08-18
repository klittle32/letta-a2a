import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ContextStore } from "../services/bridge/src/context-store.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("ContextStore", () => {
  test("persists A2A context to Letta conversation mappings", () => {
    const directory = mkdtempSync(join(tmpdir(), "letta-a2a-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "contexts.json");

    const first = new ContextStore(path);
    first.save("agent-a", "ctx-1", "conv-1");
    first.close();

    const reopened = new ContextStore(path);
    expect(reopened.get("agent-a", "ctx-1")).toBe("conv-1");
    expect(reopened.get("agent-b", "ctx-1")).toBeUndefined();
    reopened.close();
  });

  test("rejects non-string persisted conversation IDs", () => {
    const directory = mkdtempSync(join(tmpdir(), "letta-a2a-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "contexts.json");
    writeFileSync(path, JSON.stringify({ "agent-a\u0000ctx-1": { bad: true } }));

    expect(() => new ContextStore(path)).toThrow("non-empty string values");
  });
});
