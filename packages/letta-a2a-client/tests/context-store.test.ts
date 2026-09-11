import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileContextStore } from "../src/context-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("FileContextStore", () => {
  test("persists remote contexts across instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "letta-a2a-contexts-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "nested", "contexts.json");

    const first = new FileContextStore(path);
    await first.set("agent/conversation/peer", "remote-context-1");

    const second = new FileContextStore(path);
    expect(await second.get("agent/conversation/peer")).toBe(
      "remote-context-1",
    );
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      "agent/conversation/peer": "remote-context-1",
    });
  });

  test("rejects malformed state instead of silently discarding it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "letta-a2a-contexts-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "contexts.json");
    await Bun.write(path, "[]");

    await expect(new FileContextStore(path).get("key")).rejects.toThrow(
      "must contain a JSON object",
    );
  });

  test("preserves concurrent updates for different context keys", async () => {
    const directory = await mkdtemp(join(tmpdir(), "letta-a2a-contexts-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "contexts.json");
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        new FileContextStore(path).set(`key-${index}`, `context-${index}`),
      ),
    );

    const contents = JSON.parse(await readFile(path, "utf8"));
    expect(Object.keys(contents)).toHaveLength(20);
    expect(contents["key-0"]).toBe("context-0");
    expect(contents["key-19"]).toBe("context-19");
  });
});
