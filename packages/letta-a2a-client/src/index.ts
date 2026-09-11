import {
  PollingA2AInvoker,
  createOfficialClientProvider,
} from "./a2a-invoker.js";
import { parseConfig } from "./config.js";
import { MemoryContextStore, type ContextStore } from "./context-store.js";
import { A2AToolService } from "./tool-service.js";

export interface A2AClientOptions {
  routes: Record<string, string>;
  contextStore?: ContextStore;
  timeoutMs?: number;
  pollIntervalMs?: number;
  cancelTimeoutMs?: number;
}

/** Host-owned composition: no network, agent creation, or global mod installation. */
export function createA2AClient(options: A2AClientOptions): A2AToolService {
  // Reuse route validation without loading files or inheriting process config.
  const { routes } = parseConfig({ routes: options.routes }, ".");
  const timeoutMs = positiveInteger(options.timeoutMs ?? 120_000, "timeoutMs");
  const pollIntervalMs = positiveInteger(
    options.pollIntervalMs ?? 500,
    "pollIntervalMs",
  );
  const cancelTimeoutMs = positiveInteger(
    options.cancelTimeoutMs ?? 5_000,
    "cancelTimeoutMs",
  );
  return new A2AToolService(
    routes,
    new PollingA2AInvoker(createOfficialClientProvider(), {
      timeoutMs,
      pollIntervalMs,
      cancelTimeoutMs,
    }),
    options.contextStore ?? new MemoryContextStore(),
    { timeoutMs },
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new Error(`${name} must be a positive timer-safe integer`);
  }
  return value;
}

export {
  PollingA2AInvoker,
  A2AInvocationError,
  A2AInvocationCancelledError,
  createOfficialClientProvider,
} from "./a2a-invoker.js";
export type {
  A2AInvocation,
  A2AInvocationResult,
  A2AInvoker,
  A2AClientProvider,
} from "./a2a-invoker.js";
export {
  FileContextStore,
  MemoryContextStore,
  type ContextStore,
} from "./context-store.js";
export { A2AToolService, type A2AToolInput } from "./tool-service.js";
