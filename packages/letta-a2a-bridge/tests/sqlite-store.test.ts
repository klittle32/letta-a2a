import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { Task, TaskState, ListTasksRequest } from "@a2a-js/sdk";
import { InMemoryTaskStore, ServerCallContext } from "@a2a-js/sdk/server";
import { SqliteBindingStore } from "../src/sqlite-store.js";

const context = (owner = "owner", tenant = "tenant") =>
  new ServerCallContext({
    user: { userName: owner, isAuthenticated: true },
    tenant,
  });
const task = (id = "a") =>
  Task.fromJSON({
    id,
    contextId: "context",
    status: {
      state: "TASK_STATE_COMPLETED",
      timestamp: "2026-01-01T00:00:00Z",
    },
    history: [
      {
        messageId: "message",
        role: "ROLE_USER",
        parts: [{ text: "hello" }, { data: { nested: [1, true, null] } }],
      },
    ],
    artifacts: [
      {
        artifactId: "artifact",
        parts: [{ text: "result" }],
        metadata: { nested: { key: "value" } },
      },
    ],
    metadata: { custom: [1, 2] },
  });
async function fixture(work: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "sqlite-binding-"));
  try {
    await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("SqliteBindingStore", () => {
  test("roundtrip, detached snapshots, reopen, owner scopes and permissions", () =>
    fixture(async (directory) => {
      let store = await SqliteBindingStore.open({
        directory,
        bindingId: "binding",
      });
      const original = task();
      await store.save(original, context());
      original.contextId = "mutated";
      const loaded = (await store.load("a", context()))!;
      expect(loaded).toEqual(task());
      loaded.history = [];
      expect(await store.load("a", context())).toEqual(task());
      expect(await store.load("a", context("other"))).toBeUndefined();
      expect(await store.load("a", context("owner", "other"))).toBeUndefined();
      store.setRecord("messages", "key", { nested: [1] });
      store.close();
      store.close();
      expect(() => store.getRecord("messages", "key")).toThrow();
      store = await SqliteBindingStore.open({
        directory,
        bindingId: "binding",
      });
      expect(await store.load("a", context())).toEqual(task());
      expect(store.records("messages")).toEqual([["key", { nested: [1] }]]);
      expect(store.listAllTasks()).toEqual([
        { task: task(), owner: "owner", tenant: "tenant" },
      ]);
      for (const path of [
        directory,
        join(directory, "owner.sqlite"),
        join(directory, "state.sqlite"),
      ]) {
        expect((await stat(path)).mode & 0o777).toBe(
          path === directory ? 0o700 : 0o600,
        );
      }
      store.deleteTask("a", context());
      expect(await store.load("a", context())).toBeUndefined();
      store.close();
    }));

  test("official list query parity including tied and missing cursors", () =>
    fixture(async (directory) => {
      const store = await SqliteBindingStore.open({
        directory,
        bindingId: "binding",
      });
      try {
        const reference = new InMemoryTaskStore();
        for (const id of ["a", "b|pipe", "c"]) {
          await store.save(task(id), context());
          await reference.save(task(id), context());
        }
        for (const query of [
          {},
          { includeArtifacts: true },
          { pageSize: 1 },
          { historyLength: 0 },
          { historyLength: 1 },
          { contextId: "missing" },
          { status: TaskState.TASK_STATE_WORKING },
          { statusTimestampAfter: "2026-01-01T00:00:00Z" },
          { pageToken: Buffer.from("missing|id").toString("base64") },
        ]) {
          expect(
            await store.list(ListTasksRequest.fromJSON(query), context()),
          ).toEqual(
            await reference.list(ListTasksRequest.fromJSON(query), context()),
          );
        }
        const first = await reference.list(
          ListTasksRequest.fromJSON({ pageSize: 1 }),
          context(),
        );
        expect(
          await store.list(
            ListTasksRequest.fromJSON({
              pageSize: 1,
              pageToken: first.nextPageToken,
            }),
            context(),
          ),
        ).toEqual(
          await reference.list(
            ListTasksRequest.fromJSON({
              pageSize: 1,
              pageToken: first.nextPageToken,
            }),
            context(),
          ),
        );
        await expect(
          store.list(
            ListTasksRequest.fromJSON({ pageToken: "invalid" }),
            context(),
          ),
        ).rejects.toThrow();
        expect(await store.load("a", context())).toEqual(task());
      } finally {
        store.close();
      }
    }));

  test("atomic journal/task rollback and rejection of async or nested transactions", () =>
    fixture(async (directory) => {
      const store = await SqliteBindingStore.open({
        directory,
        bindingId: "binding",
      });
      try {
        expect(() =>
          store.transaction(() => {
            store.saveTask(task(), context());
            store.setRecord("x", "y", 1);
            throw new Error("rollback");
          }),
        ).toThrow("rollback");
        expect(await store.load("a", context())).toBeUndefined();
        expect(store.getRecord("x", "y")).toBeUndefined();
        expect(() =>
          store.transaction(async () => {
            store.setRecord("x", "y", 2);
          }),
        ).toThrow();
        expect(store.getRecord("x", "y")).toBeUndefined();
        expect(() =>
          store.transaction(() => store.transaction(() => 1)),
        ).toThrow();
        expect(() =>
          store.transaction(() => {
            store.setRecord("x", "y", 3);
            return Promise.resolve();
          }),
        ).toThrow();
        expect(store.getRecord("x", "y")).toBeUndefined();
        for (const value of [
          undefined,
          NaN,
          Infinity,
          new Date(),
          { x: undefined },
        ])
          expect(() => store.setRecord("x", "invalid", value)).toThrow();
        store.transaction(() => {
          store.saveTask(task(), context());
          store.setRecord("x", "y", { ok: true });
        });
        expect(store.getRecord<{ ok: boolean }>("x", "y")).toEqual({
          ok: true,
        });
        store.deleteRecord("x", "y");
        expect(store.records("x")).toEqual([]);
      } finally {
        store.close();
      }
    }));

  test("exclusive ownership, binding mismatch and corrupt state fail closed", () =>
    fixture(async (directory) => {
      const store = await SqliteBindingStore.open({
        directory,
        bindingId: "binding",
      });
      await expect(
        SqliteBindingStore.open({ directory, bindingId: "binding" }),
      ).rejects.toThrow();
      store.close();
      await expect(
        SqliteBindingStore.open({ directory, bindingId: "other" }),
      ).rejects.toThrow();
      (
        await SqliteBindingStore.open({ directory, bindingId: "binding" })
      ).close();
      // Remove recoverable WAL content to model actual unrecoverable corruption.
      await rm(join(directory, "state.sqlite-wal"), { force: true });
      await rm(join(directory, "state.sqlite-shm"), { force: true });
      await writeFile(join(directory, "state.sqlite"), "not sqlite");
      await expect(
        SqliteBindingStore.open({ directory, bindingId: "binding" }),
      ).rejects.toThrow();
    }));

  test("incompatible schema fails closed and releases ownership", () =>
    fixture(async (directory) => {
      (
        await SqliteBindingStore.open({ directory, bindingId: "binding" })
      ).close();
      const database = new DatabaseSync(join(directory, "state.sqlite"));
      database.exec("PRAGMA user_version=999");
      database.close();
      await expect(
        SqliteBindingStore.open({ directory, bindingId: "binding" }),
      ).rejects.toThrow("schema");
      const owner = new DatabaseSync(join(directory, "owner.sqlite"));
      owner.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
      owner.close();
    }));

  test("process death releases owner lock without stealing", () =>
    fixture(async (directory) => {
      const moduleUrl = new URL("../src/sqlite-store.ts", import.meta.url).href;
      const child = spawn(
        "node",
        [
          "--experimental-transform-types",
          "--input-type=module",
          "--eval",
          `const {SqliteBindingStore}=await import(${JSON.stringify(moduleUrl)}); const s=await SqliteBindingStore.open({directory:${JSON.stringify(directory)},bindingId:'binding'}); s.setRecord('x','key',42); console.log('ready'); setInterval(()=>{},1000);`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      try {
        await Promise.race([
          once(child.stdout!, "data"),
          once(child, "exit").then(() => {
            throw new Error("child exited before ready");
          }),
        ]);
        await expect(
          SqliteBindingStore.open({ directory, bindingId: "binding" }),
        ).rejects.toThrow();
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
        const store = await SqliteBindingStore.open({
          directory,
          bindingId: "binding",
        });
        expect(store.getRecord<number>("x", "key")).toBe(42);
        store.close();
      } finally {
        child.kill("SIGKILL");
      }
    }));
});
