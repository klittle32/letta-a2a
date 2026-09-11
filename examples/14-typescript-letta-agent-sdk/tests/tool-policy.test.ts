import { describe, expect, test } from "bun:test";

import {
  assertNoPersistedAgentTools,
  createA2ASessionOptions,
} from "../src/tool-policy.js";

describe("Example 14 SDK tool policy", () => {
  test("uses no base client tools and only allowlists a2a_invoke", () => {
    const options = createA2ASessionOptions("/tmp/example-14");

    expect(options).toMatchObject({
      cwd: "/tmp/example-14",
      allowedTools: ["a2a_invoke"],
      toolset: { base: "none" },
      permissionMode: "strict",
      skillSources: [],
    });
  });

  test("approves a2a_invoke and denies every other approval request", async () => {
    const canUseTool = createA2ASessionOptions("/tmp/example-14").canUseTool;
    expect(canUseTool).toBeDefined();

    await expect(canUseTool?.("a2a_invoke", {})).resolves.toEqual({
      behavior: "allow",
      updatedInput: null,
      updatedPermissions: [],
    });
    await expect(canUseTool?.("exec_command", {})).resolves.toEqual({
      behavior: "deny",
      message: "Example 14 permits only a2a_invoke",
      interrupt: false,
    });
  });

  test("rejects reused agents that already expose persisted tools", () => {
    expect(() =>
      assertNoPersistedAgentTools({ id: "agent-clean", tools: [] }),
    ).not.toThrow();
    expect(() =>
      assertNoPersistedAgentTools({
        id: "agent-with-tools",
        tools: [{ name: "exec_command" }],
      }),
    ).toThrow(
      "agent-with-tools has persisted tools (exec_command); Example 14 requires a dedicated tool-free agent",
    );
  });
});
