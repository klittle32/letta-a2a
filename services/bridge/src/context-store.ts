import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type StoredMappings = Record<string, string>;

export class ContextStore {
  private readonly mappings: StoredMappings;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.mappings = this.read();
  }

  get(agentKey: string, contextId: string): string | undefined {
    return this.mappings[this.key(agentKey, contextId)];
  }

  save(agentKey: string, contextId: string, conversationId: string): void {
    this.mappings[this.key(agentKey, contextId)] = conversationId;
    const temporaryPath = `${this.path}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.mappings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, this.path);
  }

  close(): void {
    // Kept for a storage-compatible lifecycle API.
  }

  private key(agentKey: string, contextId: string): string {
    return `${agentKey}\u0000${contextId}`;
  }

  private read(): StoredMappings {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("context store root must be an object");
      }
      if (
        Object.values(parsed as Record<string, unknown>).some(
          (value) => typeof value !== "string" || !value.trim(),
        )
      ) {
        throw new Error("context store must contain non-empty string values");
      }
      return parsed as StoredMappings;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return {};
      }
      throw new Error(`failed to read context store ${this.path}: ${String(error)}`);
    }
  }
}
