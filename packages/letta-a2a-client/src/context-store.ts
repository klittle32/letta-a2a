import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

export interface ContextStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, contextId: string): Promise<void>;
}

/**
 * Small durable map from a local Letta conversation/target pair to the remote
 * A2A context. Writes replace the complete JSON document atomically.
 */
export class FileContextStore implements ContextStore {
  constructor(private readonly path: string) {}

  async get(key: string): Promise<string | undefined> {
    return (await this.read())[key];
  }

  async set(key: string, contextId: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const release = await acquireFileLock(`${this.path}.lock`);
    try {
      const current = await this.read();
      current[key] = contextId;

      const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
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
      if (isNodeError(error) && error.code === "ENOENT") return {};
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

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string" || !value) {
        throw new Error(`${this.path} contains an invalid context for ${key}`);
      }
      result[key] = value;
    }
    return result;
  }
}

async function acquireFileLock(path: string): Promise<() => Promise<void>> {
  const deadline = Date.now() + LOCK_WAIT_MS;

  while (true) {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path, "wx", 0o600);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      if (await isStaleLock(path)) {
        await unlink(path).catch((unlinkError) => {
          if (!isNodeError(unlinkError) || unlinkError.code !== "ENOENT") {
            throw unlinkError;
          }
        });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for context-store lock ${path}`);
      }
      await sleep(10 + Math.floor(Math.random() * 20));
      continue;
    }

    const token = `${process.pid}:${crypto.randomUUID()}`;
    try {
      await handle.writeFile(`${token}\n${Date.now()}\n`, "utf8");
      return async () => {
        await handle.close();
        let currentToken: string;
        try {
          currentToken = (await readFile(path, "utf8")).split("\n", 1)[0] ?? "";
        } catch (error) {
          if (isNodeError(error) && error.code === "ENOENT") return;
          throw error;
        }
        if (currentToken === token) await unlink(path);
      };
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
      throw error;
    }
  }
}

async function isStaleLock(path: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(path)).mtimeMs >= LOCK_STALE_MS;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
