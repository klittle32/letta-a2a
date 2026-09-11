import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const WRITE_LOCK_WAIT_MS = 5_000;

export interface ContextStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  withLock<T>(
    key: string,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T>;
}

/** In-process storage with a serial queue per key. Locks are not reentrant. */
export class MemoryContextStore implements ContextStore {
  private readonly values = new Map<string, string>();
  private readonly tails = new Map<string, Promise<void>>();

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async withLock<T>(
    key: string,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });

    let onAbort!: () => void;
    const canceled = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([previous, canceled]);
      signal.throwIfAborted();
      return await work();
    } finally {
      signal.removeEventListener("abort", onAbort);
      // Even a canceled queue entry remains behind its predecessor until it exits.
      release();
    }
  }
}

/**
 * Durable string map. Key locks protect controller operations; a separate short
 * write lock protects read/modify/atomic-replace across different keys/processes.
 * All cooperating processes must use the same state path and filesystem locks.
 * Locks are not reentrant. Aborting active work does not release its lock early.
 */
export class FileContextStore implements ContextStore {
  constructor(private readonly path: string) {}

  async get(key: string): Promise<string | undefined> {
    return (await this.read())[key];
  }

  async withLock<T>(
    key: string,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    const directory = `${this.path}.locks`;
    await mkdir(directory, { recursive: true });
    const hash = createHash("sha256").update(key).digest("hex");
    const release = await acquireFileLock(
      join(directory, `${hash}.lock`),
      signal,
    );
    try {
      signal.throwIfAborted();
      return await work();
    } finally {
      await release();
    }
  }

  async set(key: string, value: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const release = await acquireFileLock(
      `${this.path}.lock`,
      AbortSignal.timeout(WRITE_LOCK_WAIT_MS),
    );
    try {
      const current = await this.read();
      current[key] = value;
      const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(current, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporary, this.path);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    } finally {
      await release();
    }
  }

  private async read(): Promise<Record<string, string>> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT")
        return Object.create(null);
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `${this.path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isRecord(parsed)) {
      throw new Error(`${this.path} must contain a JSON object`);
    }

    const result: Record<string, string> = Object.create(null);
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        throw new Error(`${this.path} contains an invalid context for ${key}`);
      }
      result[key] = value;
    }
    return result;
  }
}

async function acquireFileLock(
  path: string,
  signal: AbortSignal,
): Promise<() => Promise<void>> {
  while (true) {
    if (signal.aborted) throw lockWaitError(path, signal);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path, "wx", 0o600);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      // Never steal by age or PID: a slow live owner is indistinguishable from
      // an orphan on a shared filesystem. Recovery is explicitly manual.
      try {
        await sleep(20, undefined, { signal });
      } catch (error) {
        if (signal.aborted) throw lockWaitError(path, signal);
        throw error;
      }
      continue;
    }

    const token = `${process.pid}:${randomUUID()}`;
    const release = async () => {
      let currentToken: string;
      try {
        currentToken = (await readFile(path, "utf8")).trim();
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return;
        throw error;
      }
      if (currentToken === token) await unlink(path);
    };
    try {
      await handle.writeFile(`${token}\n`, "utf8");
    } catch (error) {
      // A partial token stays fail-closed rather than deleting an unverified lock.
      await release().catch(() => undefined);
      throw new Error(`Could not initialize lock ${path}; ${RECOVERY_NOTE}`, {
        cause: error,
      });
    } finally {
      await handle.close();
    }
    return release;
  }
}

const RECOVERY_NOTE =
  "manual recovery: only remove this lock after confirming no process is using it; locks are never automatically reclaimed";

function lockWaitError(path: string, signal: AbortSignal): Error {
  const reason =
    signal.reason instanceof Error
      ? signal.reason.message
      : String(signal.reason);
  return new Error(
    `Context-store lock wait canceled for ${path}: ${reason}; ${RECOVERY_NOTE}`,
    {
      cause: signal.reason,
    },
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
