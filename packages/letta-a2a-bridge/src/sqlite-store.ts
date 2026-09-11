import { chmod, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Task,
  type ListTasksRequest,
  type ListTasksResponse,
} from "@a2a-js/sdk";
import {
  InMemoryTaskStore,
  ServerCallContext,
  resolveUserScope,
  type TaskStore,
} from "@a2a-js/sdk/server";

/** Local trusted-directory storage. One process owns a binding for its lifetime.
 * SQLite file locking is the ownership authority; network filesystems are unsupported.
 * Call close only after execution AND SDK persistence consumers have drained.
 */
export class SqliteBindingStore implements TaskStore {
  readonly taskStore: TaskStore = this;
  private closed = false;
  private inTransaction = false;

  private constructor(
    readonly directory: string,
    private readonly state: DatabaseSync,
    private readonly owner: DatabaseSync,
  ) {}

  static async open(options: {
    directory: string;
    bindingId: string;
  }): Promise<SqliteBindingStore> {
    if (!options.bindingId.trim())
      throw new Error("An explicit binding identity is required");
    await mkdir(options.directory, { recursive: true, mode: 0o700 });
    const directory = await realpath(options.directory);
    await chmod(directory, 0o700);
    let owner: DatabaseSync | undefined;
    let state: DatabaseSync | undefined;
    try {
      owner = new DatabaseSync(join(directory, "owner.sqlite"));
      await chmod(join(directory, "owner.sqlite"), 0o600);
      owner.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
      state = new DatabaseSync(join(directory, "state.sqlite"));
      await chmod(join(directory, "state.sqlite"), 0o600);
      state.exec(
        "PRAGMA busy_timeout=0; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL",
      );
      const integrity = state.prepare("PRAGMA quick_check").get();
      if (!integrity || Object.values(integrity)[0] !== "ok")
        throw new Error("Corrupt binding storage");
      state.exec("BEGIN IMMEDIATE");
      try {
        const version = state.prepare("PRAGMA user_version").get()!
          .user_version;
        const tables = state
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .all();
        if (version === 0 && tables.length === 0) {
          state.exec(`CREATE TABLE identity (binding TEXT NOT NULL);
            CREATE TABLE tasks (tenant TEXT NOT NULL, owner TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (tenant, owner, id));
            CREATE TABLE records (collection TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (collection, key));
            PRAGMA user_version=1`);
          state
            .prepare("INSERT INTO identity(binding) VALUES (?)")
            .run(options.bindingId);
        } else if (version !== 1)
          throw new Error("Unsupported binding storage schema");
        const identities = state.prepare("SELECT binding FROM identity").all();
        if (
          identities.length !== 1 ||
          identities[0]!.binding !== options.bindingId
        )
          throw new Error("Binding identity mismatch");
        // Validate expected columns even when a damaged schema retains its version.
        state
          .prepare("SELECT tenant, owner, id, value FROM tasks LIMIT 0")
          .all();
        state
          .prepare("SELECT collection, key, value FROM records LIMIT 0")
          .all();
        state.exec("COMMIT");
      } catch (error) {
        state.exec("ROLLBACK");
        throw error;
      }
      for (const suffix of ["-wal", "-shm"]) {
        await chmod(join(directory, `state.sqlite${suffix}`), 0o600).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          },
        );
      }
      return new SqliteBindingStore(directory, state, owner);
    } catch (error) {
      try {
        state?.close();
      } finally {
        owner?.close();
      }
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Binding storage is closed");
  }

  saveTask(task: Task, context: ServerCallContext): void {
    this.assertOpen();
    const value = JSON.stringify(Task.toJSON(task));
    this.state
      .prepare(
        "INSERT INTO tasks(tenant, owner, id, value) VALUES (?, ?, ?, ?) ON CONFLICT(tenant, owner, id) DO UPDATE SET value=excluded.value",
      )
      .run(context.tenant ?? "", resolveUserScope(context), task.id, value);
  }

  async save(task: Task, context: ServerCallContext): Promise<void> {
    this.saveTask(task, context);
  }

  async load(
    id: string,
    context: ServerCallContext,
  ): Promise<Task | undefined> {
    this.assertOpen();
    const row = this.state
      .prepare("SELECT value FROM tasks WHERE tenant=? AND owner=? AND id=?")
      .get(context.tenant ?? "", resolveUserScope(context), id);
    return row ? Task.fromJSON(JSON.parse(String(row.value))) : undefined;
  }

  async list(
    params: ListTasksRequest,
    context: ServerCallContext,
  ): Promise<ListTasksResponse> {
    this.assertOpen();
    const rows = this.state
      .prepare("SELECT value FROM tasks WHERE tenant=? AND owner=?")
      .all(context.tenant ?? "", resolveUserScope(context));
    const snapshot = new InMemoryTaskStore();
    for (const row of rows)
      await snapshot.save(
        Task.fromJSON(JSON.parse(String(row.value))),
        context,
      );
    return snapshot.list(params, context);
  }

  deleteTask(id: string, context: ServerCallContext): void {
    this.assertOpen();
    this.state
      .prepare("DELETE FROM tasks WHERE tenant=? AND owner=? AND id=?")
      .run(context.tenant ?? "", resolveUserScope(context), id);
  }

  listAllTasks(): { task: Task; owner: string; tenant: string }[] {
    this.assertOpen();
    return this.state
      .prepare(
        "SELECT value, owner, tenant FROM tasks ORDER BY tenant, owner, id",
      )
      .all()
      .map((row) => ({
        task: Task.fromJSON(JSON.parse(String(row.value))),
        owner: String(row.owner),
        tenant: String(row.tenant),
      }));
  }

  getRecord<T>(collection: string, key: string): T | undefined {
    this.assertOpen();
    const row = this.state
      .prepare("SELECT value FROM records WHERE collection=? AND key=?")
      .get(collection, key);
    return row ? (JSON.parse(String(row.value)) as T) : undefined;
  }

  records<T>(collection: string): [string, T][] {
    this.assertOpen();
    return this.state
      .prepare("SELECT key, value FROM records WHERE collection=? ORDER BY key")
      .all(collection)
      .map((row) => [String(row.key), JSON.parse(String(row.value)) as T]);
  }

  setRecord(collection: string, key: string, value: unknown): void {
    this.assertOpen();
    assertJson(value);
    this.state
      .prepare(
        "INSERT INTO records(collection, key, value) VALUES (?, ?, ?) ON CONFLICT(collection, key) DO UPDATE SET value=excluded.value",
      )
      .run(collection, key, JSON.stringify(value));
  }

  deleteRecord(collection: string, key: string): void {
    this.assertOpen();
    this.state
      .prepare("DELETE FROM records WHERE collection=? AND key=?")
      .run(collection, key);
  }

  transaction<T>(callback: () => T): T {
    this.assertOpen();
    if (this.inTransaction)
      throw new Error("Nested transactions are unsupported");
    if (callback.constructor.name === "AsyncFunction")
      throw new Error("Transactions must be synchronous");
    this.state.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
    try {
      const result = callback();
      if (result && typeof (result as { then?: unknown }).then === "function") {
        // Observe rejection without treating asynchronous work as committed.
        void Promise.resolve(result).catch(() => undefined);
        throw new Error("Transactions must be synchronous");
      }
      this.state.exec("COMMIT");
      return result;
    } catch (error) {
      this.state.exec("ROLLBACK");
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  close(): void {
    if (this.closed) return;
    if (this.inTransaction)
      throw new Error("Cannot close during a transaction");
    this.closed = true;
    try {
      this.state.close();
    } finally {
      this.owner.close();
    }
  }
}

/** Refuse silent JSON loss in operational records (undefined, NaN, dates, cycles). */
function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || !value || ancestors.has(value))
    throw new Error("Record must be JSON-safe");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error("Record must be JSON-safe");
  ancestors.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value))
    assertJson(child, ancestors);
  ancestors.delete(value);
}
