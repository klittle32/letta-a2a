import { describe, expect, test } from "bun:test";

import {
  assertNoPersistedAgentTools,
  createA2ASessionOptions,
} from "../src/tool-policy.js";

describe("Example 14 SDK tool policy", () => {
  test("uses no base client tools and only allowlists the two A2A tools", () => {
    const options = createA2ASessionOptions("/tmp/example-14");

    expect(options).toMatchObject({
      cwd: "/tmp/example-14",
      allowedTools: ["a2a_invoke", "a2a_task"],
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
    await expect(canUseTool?.("a2a_task", {})).resolves.toMatchObject({
      behavior: "allow",
    });
    await expect(canUseTool?.("exec_command", {})).resolves.toEqual({
      behavior: "deny",
      message: "Tool is not allowed by this session policy",
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
