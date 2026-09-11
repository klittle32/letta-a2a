import { createA2AClient } from "../src/index.js";
import { loadConfig } from "../src/config.js";
import { FileContextStore } from "../src/context-store.js";
import type { LettaModApi } from "../src/mod-api.js";
import { A2AModController } from "../src/mod-controller.js";
import { getA2AToolDefinitions } from "../src/tool-operations.js";

export default function activate(letta: LettaModApi) {
  if (!letta.capabilities.tools) return;

  const owner = new AbortController();
  let client: ReturnType<typeof createA2AClient> | undefined;
  let controller: A2AModController | undefined;
  let configurationError: string | undefined;
  try {
    const config = loadConfig();
    client = createA2AClient({
      routes: config.routes,
      timeoutMs: config.timeoutMs,
      pollIntervalMs: config.pollIntervalMs,
      contextStore: new FileContextStore(config.contextStorePath),
    });
    controller = new A2AModController(client);
  } catch (error) {
    configurationError =
      error instanceof Error ? error.message : "Invalid A2A configuration";
    letta.diagnostics.report({
      message: `A2A tools unavailable: ${configurationError}`,
      severity: "error",
    });
  }

  const unregister: Array<() => void> = [];
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    owner.abort();
    client?.close();
    for (const remove of unregister.reverse()) {
      try {
        remove();
      } catch {
        letta.diagnostics.report({
          message: "Failed to unregister an A2A tool",
          severity: "error",
        });
      }
    }
  };
  try {
    for (const definition of getA2AToolDefinitions(
      client ?? { targets: () => [] },
    )) {
      unregister.push(
        letta.tools.register({
          ...definition,
          async run(context) {
            if (!controller)
              return {
                status: "error",
                content: configurationError ?? "A2A client is not configured",
              };
            return controller.run(definition.name, {
              ...context,
              signal: AbortSignal.any([owner.signal, context.signal]),
            });
          },
        }),
      );
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}
