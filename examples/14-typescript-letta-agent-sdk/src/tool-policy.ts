import type { CreateSessionOptions } from "@letta-ai/letta-agent-sdk";

interface PersistedAgentToolProjection {
  id: string;
  tools?: unknown;
}

/**
 * Example 14 is noninteractive. Keep strict mode, suppress the base client
 * toolset, and resolve approval requests deterministically at the SDK boundary.
 */
export function createA2ASessionOptions(cwd: string): CreateSessionOptions {
  return {
    cwd,
    allowedTools: ["a2a_invoke"],
    toolset: { base: "none" },
    permissionMode: "strict",
    skillSources: [],
    canUseTool: async (toolName) => {
      if (toolName === "a2a_invoke") {
        return {
          behavior: "allow",
          updatedInput: null,
          updatedPermissions: [],
        };
      }
      return {
        behavior: "deny",
        message: "Example 14 permits only a2a_invoke",
        interrupt: false,
      };
    },
  };
}

/** Client allowlists do not remove persisted agent tools, so reuse is fail-closed. */
export function assertNoPersistedAgentTools(
  agent: PersistedAgentToolProjection,
): void {
  if (!Array.isArray(agent.tools)) {
    throw new Error(
      `${agent.id} did not report its persisted tools; Example 14 cannot enforce a tool-free agent`,
    );
  }
  if (agent.tools.length === 0) return;

  const names = agent.tools.map((tool) => {
    if (typeof tool === "string" && tool) return tool;
    if (tool && typeof tool === "object" && "name" in tool) {
      const name = (tool as { name?: unknown }).name;
      if (typeof name === "string" && name) return name;
    }
    return "unknown";
  });
  throw new Error(
    `${agent.id} has persisted tools (${names.join(", ")}); Example 14 requires a dedicated tool-free agent`,
  );
}
