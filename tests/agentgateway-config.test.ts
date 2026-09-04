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
  test("pins one shared A2A-aware gateway with strict OAuth JWT authentication", () => {
    const config = Bun.YAML.parse(
      readFileSync("agentgateway/config.yaml", "utf8"),
    ) as any;

    expect(config.config.logging.format).toBe("json");
    expect(config.config.database).toBeUndefined();
    expect(config.gateways.a2a.port).toBe(4000);
    expect(config.gateways.a2a.apiKey).toBeUndefined();
    expect(config.gateways.a2a.jwtAuth).toEqual({
      mode: "strict",
      preserveToken: false,
      issuer: "$OAUTH_ISSUER",
      audiences: ["letta-a2a-gateway"],
      jwks: { url: "http://auth-server:9000/jwks" },
      jwtValidationOptions: {
        requiredClaims: ["exp", "nbf", "sub", "scope", "role"],
      },
    });
    expect(config.gateways.a2a.authorization).toEqual({
      rules: [
        {
          allow:
            'request.method == "GET" && request.path.endsWith("/.well-known/agent-card.json") && jwt.scope.split(" ").exists(grant, grant == "a2a.discover")',
        },
        {
          allow:
            'request.method == "POST" && ["operator", "agent"].exists(role, role == jwt.role) && jwt.scope.split(" ").exists(grant, grant == "a2a.invoke")',
        },
      ],
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
    expect(service.environment.OAUTH_ISSUER).toBe(
      "http://127.0.0.1:${OAUTH_PORT:-9000}",
    );
    expect(service.ports).toEqual([
      "127.0.0.1:${A2A_GATEWAY_PORT:-4000}:4000",
      "127.0.0.1:${A2A_GATEWAY_UI_PORT:-4090}:4090",
    ]);
    expect(service.volumes).toEqual([
      "./agentgateway/config.yaml:/config.yaml:ro",
    ]);
    expect(service.depends_on).toEqual({
      "auth-server": { condition: "service_healthy" },
    });

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
    expect(compose.services["reference-agent"].environment.OAUTH_TOKEN_URL).toBe(
      "http://auth-server:9000/token",
    );
    expect(compose.services.bridge.environment.OAUTH_CLIENT_ID).toBe(
      "${OAUTH_BRIDGE_CLIENT_ID:-bridge-client}",
    );
    expect(compose.services.bridge.environment.OAUTH_SCOPE).toBe(
      "a2a.discover a2a.invoke",
    );
    expect(compose.services["reference-agent"].environment.OAUTH_CLIENT_ID).toBe(
      "${OAUTH_REFERENCE_CLIENT_ID:-reference-agent-client}",
    );
    expect(compose.services["reference-agent"].environment.OAUTH_SCOPE).toBe(
      "a2a.discover a2a.invoke",
    );
    expect(compose.services["reference-agent"].environment.A2A_GATEWAY_KEY).toBeUndefined();
    expect(compose.services.bridge.environment.PUSH_CALLBACK_URL).toBe(
      "http://webhook-receiver:8100/callbacks/a2a",
    );
    expect(compose.services["reference-agent"].environment.PUSH_CALLBACK_URL).toBe(
      "http://webhook-receiver:8100/callbacks/a2a",
    );
    expect(compose.services.bridge.environment.PUSH_CALLBACK_TOKEN).toBe(
      "${PUSH_CALLBACK_TOKEN:-a2a-lab-callback-secret}",
    );

    const receiver = compose.services["webhook-receiver"];
    expect(receiver.command).toEqual([
      "uvicorn",
      "reference_agent.webhook_receiver:app",
      "--host",
      "0.0.0.0",
      "--port",
      "8100",
    ]);
    expect(receiver.ports).toEqual([
      "127.0.0.1:${PUSH_RECEIVER_PORT:-8100}:8100",
    ]);
    expect(receiver.environment.PUSH_CALLBACK_TOKEN).toBe(
      "${PUSH_CALLBACK_TOKEN:-a2a-lab-callback-secret}",
    );
    expect(receiver.environment.PUSH_OBSERVER_TOKEN).toBe(
      "${PUSH_OBSERVER_TOKEN:-a2a-lab-observer-secret}",
    );

    const authServer = compose.services["auth-server"];
    expect(authServer.command).toEqual([
      "uvicorn",
      "reference_agent.auth_server:app",
      "--host",
      "0.0.0.0",
      "--port",
      "9000",
    ]);
    expect(authServer.ports).toEqual([
      "127.0.0.1:${OAUTH_PORT:-9000}:9000",
    ]);
    expect(authServer.environment.OAUTH_CLIENT_ID).toBe(
      "${OAUTH_CLIENT_ID:-operator-client}",
    );
    expect(authServer.environment.OAUTH_BRIDGE_CLIENT_ID).toBe(
      "${OAUTH_BRIDGE_CLIENT_ID:-bridge-client}",
    );
    expect(authServer.environment.OAUTH_REFERENCE_CLIENT_ID).toBe(
      "${OAUTH_REFERENCE_CLIENT_ID:-reference-agent-client}",
    );
    expect(authServer.environment.OAUTH_OBSERVER_CLIENT_ID).toBe(
      "${OAUTH_OBSERVER_CLIENT_ID:-observer-client}",
    );
    expect(authServer.environment.OAUTH_DENIED_CLIENT_ID).toBe(
      "${OAUTH_DENIED_CLIENT_ID:-denied-invoker-client}",
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
