import { FileContextStore } from "../../src/context-store.js";

const [path, key] = process.argv.slice(2);
if (!path || !key) throw new Error("Expected state path and lock key");
const store = new FileContextStore(path);
const release = new Promise<void>((resolve) => {
  process.stdin.once("data", () => resolve());
});
await store.withLock(key, AbortSignal.timeout(10_000), async () => {
  console.log("acquired");
  await release;
  const value = Number((await store.get(key)) ?? "0") + 1;
  await store.set(key, String(value));
});
process.stdin.destroy();
