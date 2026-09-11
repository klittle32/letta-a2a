import type { CreateSessionOptions } from "@letta-ai/letta-agent-sdk";

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
