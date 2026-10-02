import { expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";

test("defaults to GPT-6 Luna at high reasoning on port 8000 with no source check", () => {
  const config = loadConfig({});
  expect(config).toMatchObject({
    port: 8000,
    model: "openai/gpt-6-luna",
    reasoningEffort: "high",
    agentName: "Scooter",
  });
  expect(config.allowedSourceVms.size).toBe(0);
});

test("source VMs parse from a comma-separated list", () => {
  expect([
    ...loadConfig({ ALLOWED_SOURCE_VMS: " gateway-a, gateway-b ,," })
      .allowedSourceVms,
  ]).toEqual(["gateway-a", "gateway-b"]);
});

test("invalid model, reasoning, or port fails before any Letta setup", () => {
  // Catalog ids carry the tier in the name; createAgent only accepts handles.
  expect(() => loadConfig({ SCOOTER_MODEL: "gpt-6-luna-high" })).toThrow(
    /handle/,
  );
  expect(() => loadConfig({ SCOOTER_REASONING: "extreme" })).toThrow();
  expect(() => loadConfig({ PORT: "0" })).toThrow();
});
