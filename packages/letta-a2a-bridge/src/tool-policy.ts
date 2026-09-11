import type { CreateSessionOptions } from "@letta-ai/letta-agent-sdk";

interface AgentInventoryClient {
  agents: { retrieve(id: string): Promise<{ id: string; tools?: unknown }> };
}

/** Read-only preflight. Invoke inside the runner's turn lock, before SDK execution. */
export function createAgentToolGuard(
  client: AgentInventoryClient,
  agentId: string,
  options: { allowedToolIds?: readonly string[]; timeoutMs?: number } = {},
): (signal: AbortSignal) => Promise<void> {
  const allowed = new Set(options.allowedToolIds ?? []);
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (
    !agentId ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 2_147_483_647
  ) {
    throw new Error(
      "Agent tool governance requires an agent ID and a valid timeout",
    );
  }
  return async (signal) => {
    signal.throwIfAborted();
    const controller = new AbortController();
    const relay = () => controller.abort(signal.reason);
    signal.addEventListener("abort", relay, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error("Agent tool governance timed out")),
      timeoutMs,
    );
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const agent = await Promise.race([
        aborted,
        Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return client.agents.retrieve(agentId);
        }),
      ]);
      controller.signal.throwIfAborted();
      if (agent.id !== agentId)
        throw new Error("Agent tool governance identity mismatch");
      if (!Array.isArray(agent.tools))
        throw new Error("Agent tool inventory is missing");
      for (const tool of agent.tools) {
        if (
          !tool ||
          typeof tool !== "object" ||
          typeof tool.id !== "string" ||
          !tool.id
        ) {
          throw new Error(
            "Persisted tool identity is missing; cannot authorize by name alone",
          );
        }
        if (!allowed.has(tool.id))
          throw new Error("Agent has an unapproved persisted tool");
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", relay);
      controller.signal.removeEventListener("abort", onAbort);
    }
  };
}

/** Noninteractive client-tool policy. Persisted server tools need separate governance. */
export function createToolPolicy(
  allowedTools: readonly string[] = [],
): CreateSessionOptions {
  const allowed = new Set(allowedTools);
  return {
    allowedTools: [...allowed],
    toolset: { base: "none" },
    permissionMode: "strict",
    skillSources: [],
    canUseTool: async (name) =>
      allowed.has(name)
        ? { behavior: "allow", updatedInput: null, updatedPermissions: [] }
        : {
            behavior: "deny",
            message: "Tool is not allowed by this session policy",
            interrupt: false,
          },
  };
}
