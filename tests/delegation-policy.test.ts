import { describe, expect, test } from "bun:test";

import {
  assertDelegationRequestIsAsync,
  extractA2AHop,
  shouldExposeDelegationTool,
} from "../services/bridge/src/delegation-policy.js";

describe("delegation hop policy", () => {
  test("exposes A2A delegation only for an explicit top-level request", () => {
    expect(
      shouldExposeDelegationTool(
        "Use a2a_invoke to ask agent-b for help",
        0,
        1,
      ),
    ).toBe(true);
    expect(shouldExposeDelegationTool("Reply exactly OK", 0, 1)).toBe(false);
    expect(
      shouldExposeDelegationTool(
        "Use a2a_invoke to ask agent-a for help",
        1,
        1,
      ),
    ).toBe(false);
  });

  test("extracts a bounded hop count from A2A metadata", () => {
    expect(extractA2AHop(undefined)).toBe(0);
    expect(extractA2AHop({ lettaA2aLab: { hop: 1 } })).toBe(1);
    expect(extractA2AHop({ lettaA2aLab: { hop: -1 } })).toBe(0);
  });

  test("rejects blocking requests that would re-enter one LiteLLM gateway", () => {
    expect(() =>
      assertDelegationRequestIsAsync("Use a2a_invoke to ask agent-b", false),
    ).toThrow("returnImmediately=true");
    expect(() =>
      assertDelegationRequestIsAsync("Use a2a_invoke to ask agent-b", true),
    ).not.toThrow();
    expect(() =>
      assertDelegationRequestIsAsync("Answer this directly", false),
    ).not.toThrow();
  });
});
