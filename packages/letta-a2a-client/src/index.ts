import {
  PollingA2AInvoker,
  createOfficialClientProvider,
} from "./a2a-invoker.js";
import { parseConfig } from "./config.js";
import { MemoryContextStore, type ContextStore } from "./context-store.js";
import { A2AToolService } from "./tool-service.js";
import { compilePolicy, type ClientRoutePolicy } from "./client-policy.js";
export type {
  ClientRoutePolicy,
  ClientCredential,
  CredentialOwner,
} from "./client-policy.js";

export interface A2AClientOptions {
  routes: Record<string, string>;
  contextStore?: ContextStore;
  /** Host-only policies keyed by route alias. Same-endpoint aliases must agree. */
  routePolicies?: Readonly<Record<string, ClientRoutePolicy>>;
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
  const policies: Record<string, ClientRoutePolicy> = {};
  const identities: Record<string, string> = {};
  const seen = new Map<string, ReturnType<typeof compilePolicy> | undefined>();
  for (const alias of Object.keys(options.routePolicies ?? {}))
    if (!(alias in routes))
      throw new Error("Policy references an unknown A2A route");
  for (const [alias, url] of Object.entries(routes)) {
    const policy = options.routePolicies?.[alias];
    const compiled = policy ? compilePolicy(policy) : undefined;
    compiled?.check(url);
    const previous = seen.get(url);
    if (
      seen.has(url) &&
      (previous?.signature !== compiled?.signature ||
        previous?.provide !== compiled?.provide)
    )
      throw new Error(
        "Conflicting same-URL A2A alias policies; use separate client instances",
      );
    seen.set(url, compiled);
    if (policy && compiled) {
      policies[url] = policy;
      identities[new URL(url).href] = compiled.identity;
    }
  }
  return new A2AToolService(
    routes,
    new PollingA2AInvoker(createOfficialClientProvider({ policies }), {
      timeoutMs,
      pollIntervalMs,
      cancelTimeoutMs,
    }),
    options.contextStore ?? new MemoryContextStore(),
    { timeoutMs, identities },
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
