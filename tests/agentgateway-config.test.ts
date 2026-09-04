import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const EXPECTED_IMAGE =
  "cr.agentgateway.dev/agentgateway@sha256:bf2f339ef326d32def2aaeb44b1b4549801293c19b89e764a4228667d97d9896";
const TARGETS = {
  "agent-a": {
    backend: "bridge:8080",
    prefix: "/agents/agent-a",
  },
  "agent-b": {
    backend: "bridge:8080",
    prefix: "/agents/agent-b",
  },
  "reference-agent": {
    backend: "reference-agent:8090",
    prefix: "/",
  },
} as const;

describe("primary agentgateway topology", () => {
  test("pins one shared A2A-aware gateway with strict lab authentication", () => {
    const config = Bun.YAML.parse(
      readFileSync("agentgateway/config.yaml", "utf8"),
    ) as any;

    expect(config.config.logging.format).toBe("json");
    expect(config.config.database).toBeUndefined();
    expect(config.gateways.a2a.port).toBe(4000);
    expect(config.gateways.a2a.apiKey).toEqual({
      mode: "strict",
      keys: [{ key: "$A2A_GATEWAY_KEY" }],
    });
    expect(config.gateways.ui.port).toBe(4090);
    expect(config.ui.gateways).toEqual(["ui"]);

    expect(config.routes).toHaveLength(3);
    for (const [target, expected] of Object.entries(TARGETS)) {
      const route = config.routes.find((candidate: any) => candidate.name === target);
      expect(route.gateways).toEqual(["a2a"]);
      expect(route.matches).toEqual([
        { path: { pathPrefix: `/a2a/${target}` } },
      ]);
      expect(route.policies.a2a).toEqual({});
      expect(route.policies.urlRewrite.path.prefix).toBe(expected.prefix);
      expect(route.backends).toEqual([{ host: expected.backend }]);
    }
  });

  test("uses agentgateway as the only gateway in the primary Compose path", () => {
    const compose = Bun.YAML.parse(
      readFileSync("compose.yaml", "utf8"),
    ) as any;
    const service = compose.services.agentgateway;

    expect(compose["x-litellm-gateway"]).toBeUndefined();
    expect(Object.keys(compose.services).filter((name) => name.includes("litellm"))).toEqual([]);
    expect(service.image).toBe(EXPECTED_IMAGE);
    expect(service.command).toEqual(["-f", "/config.yaml"]);
    expect(service.ports).toEqual([
      "127.0.0.1:${A2A_GATEWAY_PORT:-4000}:4000",
      "127.0.0.1:${A2A_GATEWAY_UI_PORT:-4090}:4090",
    ]);
    expect(service.volumes).toEqual([
      "./agentgateway/config.yaml:/config.yaml:ro",
    ]);
    expect(service.depends_on).toBeUndefined();

    const gatewayUrls = JSON.parse(
      compose.services.bridge.environment.A2A_GATEWAY_URLS,
    );
    expect(gatewayUrls).toEqual({
      "agent-a": "http://agentgateway:4000",
      "agent-b": "http://agentgateway:4000",
      "reference-agent": "http://agentgateway:4000",
    });
    expect(compose.services["reference-agent"].environment.A2A_LETTA_URL).toBe(
      "http://agentgateway:4000/a2a/agent-a",
    );
    expect(compose.services["reference-agent"].environment.A2A_GATEWAY_KEY).toBe(
      "${A2A_GATEWAY_KEY:-sk-a2a-lab-only}",
    );
  });

  test("removes the temporary comparison layer and prior gateway configuration", () => {
    expect(existsSync("compose.agentgateway.yaml")).toBe(false);
    expect(existsSync("scripts/evaluate-agentgateway.mjs")).toBe(false);
    expect(existsSync("litellm/config.yaml")).toBe(false);

    const integration = readFileSync("scripts/integration-a2a.mjs", "utf8");
    const smoke = readFileSync("scripts/smoke-a2a.mjs", "utf8");
    expect(integration).not.toContain("LITELLM_");
    expect(smoke).not.toContain("LITELLM_");
  });
});
