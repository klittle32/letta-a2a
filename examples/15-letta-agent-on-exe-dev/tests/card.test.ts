import { expect, test } from "bun:test";
import { AgentCard } from "@a2a-js/sdk";
import { createBridge } from "letta-a2a-bridge";
import { applyScooterCard, GATEWAY_API_KEY_SECURITY } from "../src/card.js";

test("Scooter's card advertises its skills and the gateway API key in wire form", async () => {
  const bridge = createBridge({
    sharingDomain: "card-test",
    publicBaseUrl: "http://127.0.0.1:8000",
    name: "Scooter",
    security: GATEWAY_API_KEY_SECURITY,
    runner: {
      async runTurn() {
        return { text: "unused" };
      },
    },
  });
  applyScooterCard(bridge.card);
  const json = AgentCard.toJSON(bridge.card) as Record<string, unknown>;
  expect(json.name).toBe("Scooter");
  expect(
    (json.skills as { id: string }[]).map((skill) => skill.id),
  ).toEqual(["classify", "extract", "generate", "normalize"]);
  expect(json.securitySchemes).toEqual({
    gatewayApiKey: {
      apiKeySecurityScheme: {
        description: "API key issued by the agentgateway operator.",
        location: "header",
        name: "X-API-Key",
      },
    },
  });
  // The a2a CLI 0.3.0 rejects the spec-correct requirement form; keep it absent.
  expect(json.securityRequirements ?? []).toEqual([]);
  await bridge.close();
});
