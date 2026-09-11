import {
  createBridge,
  createBridgeRouter,
  createPushNotifications,
  type Bridge,
  type LettaTurnRunner,
} from "letta-a2a-bridge";
import type { AgentDefinition } from "./config.js";
import { createServiceAuth, type AuthOptions } from "./auth.js";
import { createAgentCard, type OAuthCardConfig } from "./mapping.js";

export interface ServiceBindingOptions {
  definition: AgentDefinition & { publicBaseUrl: string };
  runtime: LettaTurnRunner;
  auth: AuthOptions;
  oauth: OAuthCardConfig;
  push: Parameters<typeof createPushNotifications>[0];
  shutdownTimeoutMs?: number;
}

export interface ServiceBinding {
  bridge: Bridge;
  router: ReturnType<typeof createBridgeRouter>;
  mountPath: string;
  close: Bridge["close"];
}

/** One definition, one runner, one independently owner-scoped SDK binding. */
export function createServiceBinding(
  options: ServiceBindingOptions,
): ServiceBinding {
  const auth = createServiceAuth(options.auth);
  const card = createAgentCard(options.definition, options.oauth);
  const push = createPushNotifications(options.push);
  const bridge = createBridge({
    runner: options.runtime,
    sharingDomain: options.definition.key,
    publicBaseUrl: new URL(options.definition.publicBaseUrl).origin,
    name: options.definition.displayName,
    security: card,
    auth: auth.authorization,
    transport: auth.transport,
    push,
    shutdownTimeoutMs: options.shutdownTimeoutMs,
  });
  // The SDK holds this same object for card lookup and version negotiation.
  Object.assign(bridge.card, card);
  return {
    bridge,
    router: createBridgeRouter(bridge, { legacyCompat: { enabled: true } }),
    mountPath: `/agents/${options.definition.key}`,
    close: () => bridge.close(),
  };
}
