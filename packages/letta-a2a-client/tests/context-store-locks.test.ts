import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { FileContextStore, MemoryContextStore } from "../src/context-store.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories: string[] = [];
const workers: ChildProcess[] = [];

function statePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "letta-a2a-lock-"));
  temporaryDirectories.push(directory);
  return join(directory, "contexts.json");
}

function worker(path: string, key: string) {
  const child = spawn(
    process.execPath,
    [join(import.meta.dir, "fixtures/context-store-worker.ts"), path, key],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  workers.push(child);
  let output = "";
  let errors = "";
  child.stdout.on("data", (data) => {
    output += String(data);
  });
  child.stderr.on("data", (data) => {
    errors += String(data);
  });
  const done = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  return {
    acquired: () => output.includes("acquired"),
    async ready() {
      const deadline = Date.now() + 5_000;
      while (!output.includes("acquired")) {
        if (Date.now() > deadline || child.exitCode !== null) {
          throw new Error(`Worker did not acquire lock: ${errors}`);
        }
        await sleep(10);
      }
    },
    async finish() {
      child.stdin.end("release\n");
      expect(await done).toBe(0);
      expect(errors).toBe("");
    },
  };
}

afterEach(() => {
  for (const child of workers.splice(0)) {
    if (child.exitCode === null) child.kill();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("client context stores", () => {
  for (const kind of ["memory", "file"] as const) {
    test(`${kind}: queued cancellation does not release the owner; errors release locks`, async () => {
      const store =
        kind === "memory"
          ? new MemoryContextStore()
          : new FileContextStore(statePath());
      let release!: () => void;
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ownerController = new AbortController();
      const owner = store.withLock("same", ownerController.signal, async () => {
        entered();
        await gate;
      });
      await ready;
      const controller = new AbortController();
      let canceledRan = false;
      const waiter = store.withLock("same", controller.signal, async () => {
        canceledRan = true;
      });
      controller.abort(new Error("cancel waiter"));
      await expect(waiter).rejects.toThrow("cancel waiter");
      let successorRan = false;
      const successor = store.withLock(
        "same",
        AbortSignal.timeout(2_000),
        async () => {
          successorRan = true;
          return 42;
        },
      );
      await store.withLock(
        "different",
        AbortSignal.timeout(2_000),
        async () => {
          await store.set("__proto__", "safe");
          await store.set("empty", "");
        },
      );
      ownerController.abort();
      await sleep(50);
      expect(successorRan).toBe(false);
      release();
      await owner;
      expect(await successor).toBe(42);
      expect(canceledRan).toBe(false);
      expect(await store.get("__proto__")).toBe("safe");
      expect(await store.get("empty")).toBe("");
      expect(await store.get("toString")).toBeUndefined();
      await expect(
        store.withLock("same", AbortSignal.timeout(2_000), async () => {
          throw new Error("work failed");
        }),
      ).rejects.toThrow("work failed");
      await store.withLock("same", AbortSignal.timeout(2_000), async () => {
        await store.withLock("nested", AbortSignal.timeout(2_000), async () => {
          await store.set("nested", "record");
        });
      });
      const aborted = AbortSignal.abort(new Error("already canceled"));
      await expect(
        store.withLock("same", aborted, async () => {
          throw new Error("must not run");
        }),
      ).rejects.toThrow("already canceled");
    });
  }

  test("distinct processes serialize same keys and continue after reopen", async () => {
    const path = statePath();
    writeFileSync(path, JSON.stringify({ legacy: "ctx-original" }));
    const first = worker(path, "counter");
    await first.ready();
    const second = worker(path, "counter");
    await sleep(150);
    expect(second.acquired()).toBe(false);
    await first.finish();
    await second.ready();
    await second.finish();
    const third = worker(path, "counter");
    await third.ready();
    await third.finish();
    expect(await new FileContextStore(path).get("counter")).toBe("3");
    expect(await new FileContextStore(path).get("legacy")).toBe("ctx-original");
  });

  test("different process keys run concurrently and preserve every write", async () => {
    const path = statePath();
    const running = Array.from({ length: 8 }, (_, i) =>
      worker(path, `key-${i}`),
    );
    await Promise.all(running.map((child) => child.ready()));
    await Promise.all(running.map((child) => child.finish()));
    const contents = JSON.parse(readFileSync(path, "utf8"));
    expect(contents).toEqual(
      Object.fromEntries(running.map((_, i) => [`key-${i}`, "1"])),
    );
    expect(readdirSync(`${path}.locks`)).toEqual([]);
  });

  test("old live locks are never stolen; canceled waits explain manual recovery", async () => {
    const path = statePath();
    const owner = worker(path, "counter");
    await owner.ready();
    const [name] = readdirSync(`${path}.locks`);
    const lock = join(`${path}.locks`, name!);
    utimesSync(lock, new Date(0), new Date(0));
    const before = readFileSync(lock, "utf8");
    await expect(
      new FileContextStore(path).withLock(
        "counter",
        AbortSignal.timeout(80),
        async () => {
          throw new Error("must not acquire");
        },
      ),
    ).rejects.toThrow("manual recovery");
    expect(readFileSync(lock, "utf8")).toBe(before);
    await owner.finish();
  });

  test("release leaves a replacement ownership token untouched", async () => {
    const path = statePath();
    const store = new FileContextStore(path);
    await store.withLock("key", AbortSignal.timeout(2_000), async () => {
      const [name] = readdirSync(`${path}.locks`);
      writeFileSync(join(`${path}.locks`, name!), "replacement-owner\n");
    });
    const [name] = readdirSync(`${path}.locks`);
    expect(readFileSync(join(`${path}.locks`, name!), "utf8")).toBe(
      "replacement-owner\n",
    );
    await expect(
      store.withLock("key", AbortSignal.timeout(50), async () => {}),
    ).rejects.toThrow("manual recovery");
  });

  test("an old orphan write lock times out without stealing or resetting state", async () => {
    const path = statePath();
    const text = '{"legacy":"ctx-original"}';
    writeFileSync(path, text);
    writeFileSync(`${path}.lock`, "orphan-owner\n");
    utimesSync(`${path}.lock`, new Date(0), new Date(0));
    await expect(
      new FileContextStore(path).set("new", "value"),
    ).rejects.toThrow("manual recovery");
    expect(readFileSync(path, "utf8")).toBe(text);
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("orphan-owner\n");
  }, 10_000);

  test("malformed state fails closed without modifying existing bytes", async () => {
    const path = statePath();
    for (const text of ["{broken", "[]", "null", '{"key":7}']) {
      writeFileSync(path, text);
      const store = new FileContextStore(path);
      await expect(store.get("key")).rejects.toThrow();
      await expect(store.set("new", "value")).rejects.toThrow();
      expect(readFileSync(path, "utf8")).toBe(text);
    }
    writeFileSync(path, '{"legacy":"ctx-1"}');
    const record = JSON.stringify({ owner: "controller", state: "running" });
    await new FileContextStore(path).set("metadata", record);
    expect(await new FileContextStore(path).get("metadata")).toBe(record);
    expect(await new FileContextStore(path).get("legacy")).toBe("ctx-1");
  });
});
