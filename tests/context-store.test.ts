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

  test("does not publish a mapping when disk persistence fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "letta-a2a-"));
    temporaryDirectories.push(directory);
    const store = new ContextStore(join(directory, "contexts.json"));
    store.save("agent-a", "owned-key", "conv-old");
    rmSync(directory, { recursive: true });
    expect(() => store.save("agent-a", "owned-key", "conv-new")).toThrow();
    expect(store.get("agent-a", "owned-key")).toBe("conv-old");
  });

  test("preserves legacy mappings without adopting them for owner-scoped keys", () => {
    const directory = mkdtempSync(join(tmpdir(), "letta-a2a-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "contexts.json");
    writeFileSync(
      path,
      JSON.stringify({ "agent-a\u0000ctx-1": "conv-legacy" }),
    );
    const store = new ContextStore(path);
    expect(store.get("agent-a", "owner-scoped:ctx-1")).toBeUndefined();
    store.save("agent-a", "owner-scoped:ctx-1", "conv-owned");
    const reopened = new ContextStore(path);
    expect(reopened.get("agent-a", "ctx-1")).toBe("conv-legacy");
    expect(reopened.get("agent-a", "owner-scoped:ctx-1")).toBe("conv-owned");
  });

  test("rejects non-string persisted conversation IDs", () => {
    const directory = mkdtempSync(join(tmpdir(), "letta-a2a-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "contexts.json");
    writeFileSync(
      path,
      JSON.stringify({ "agent-a\u0000ctx-1": { bad: true } }),
    );

    expect(() => new ContextStore(path)).toThrow("non-empty string values");
  });
});
