import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const HERMES_IMAGE =
  "docker.io/nousresearch/hermes-agent:v2026.8.31@sha256:64923faeae267792bf9bf87fe3b4c4869e35004e360c7df01730ad801b74d524";

describe("Example 12 topology", () => {
  test("pins profile-gated Hermes and Google ADK services", () => {
    const compose = Bun.YAML.parse(readFileSync("compose.yaml", "utf8")) as any;
    const hermes = compose.services["hermes-tui"];
    const adk = compose.services["google-adk-agent"];

    expect(hermes.image).toBe(HERMES_IMAGE);
    expect(hermes.profiles).toEqual(["example-12-live"]);
    expect(hermes.stdin_open).toBe(true);
    expect(hermes.tty).toBe(true);
    expect(hermes.ports).toBeUndefined();
    expect(hermes.networks).toEqual(["a2a-clients"]);
    expect(hermes.volumes).toContain("hermes-state:/opt/data");
    expect(hermes.environment.OPENAI_API_KEY).toBeUndefined();
    expect(hermes.environment.HERMES_OPENAI_API_KEY_FILE).toBe(
      "/run/secrets/openai-api-key",
    );
    expect(hermes.secrets).toEqual(["hermes-oauth-client-secret"]);
    expect(hermes.volumes).toContain(
      "${OPENAI_API_KEY_SECRET_FILE:-./.openai-api-key}:/run/secrets/openai-api-key:ro",
    );
    expect(adk.environment.OPENAI_API_KEY).toBeUndefined();
    expect(adk.environment.OPENAI_API_KEY_FILE).toBe(
      "/run/secrets/openai-api-key",
    );
    expect(adk.secrets).toBeUndefined();
    expect(adk.volumes).toEqual([
      "${OPENAI_API_KEY_SECRET_FILE:-./.openai-api-key}:/run/secrets/openai-api-key:ro",
    ]);
    expect(hermes.environment.HERMES_OAUTH_CLIENT_SECRET_FILE).toBe(
      "/run/secrets/hermes-oauth-client-secret",
    );
    expect(hermes.environment.HERMES_A2A_GATEWAY_URL).toBe(
      "http://agentgateway:4000/a2a/google-adk",
    );
    expect(hermes.environment.HERMES_MODEL).toBe("${HERMES_MODEL:-gpt-5-mini}");
    expect(hermes.environment.HERMES_A2A_ACCESS_TOKEN).toBeUndefined();

    expect(adk.profiles).toEqual(["example-12", "example-12-live"]);
    expect(adk.ports).toBeUndefined();
    expect(adk.networks).toEqual(["a2a-lab"]);
    expect(adk.environment.PUBLIC_BASE_URL).toBe(
      "http://google-adk-agent:8000",
    );
    expect(adk.environment.ADK_MODEL_MODE).toBe("${ADK_MODEL_MODE:-live}");
    expect(adk.environment.ADK_MODEL).toBe("${ADK_MODEL:-openai/gpt-4.1-nano}");
    expect(compose.services.agentgateway.networks).toEqual([
      "a2a-lab",
      "a2a-clients",
    ]);
    expect(compose.services["auth-server"].networks).toEqual([
      "a2a-lab",
      "a2a-clients",
    ]);
  });

  test("keeps Hermes outbound-only and fixes its named peer", () => {
    const config = Bun.YAML.parse(
      readFileSync("services/hermes/config.yaml", "utf8"),
    ) as any;

    expect(config._config_version).toBe(39);
    expect(config.plugins.enabled).toEqual(["a2a-platform"]);
    expect(config.platform_toolsets.cli).toEqual(["hermes-cli", "a2a"]);
    expect(config.gateway?.platforms?.a2a?.enabled).not.toBe(true);
    expect(config.a2a_agents).toEqual({
      "google-adk": {
        url: "http://agentgateway:4000/a2a/google-adk",
        auth: {
          type: "bearer",
          token: "${HERMES_A2A_ACCESS_TOKEN}",
        },
        timeout: 120,
        capabilities: ["conversation"],
      },
    });
    expect(config.model.provider).toBe("openai-api");
    expect(config.model.default).toBe("${HERMES_MODEL}");
  });

  test("routes the ADK agent through the existing authenticated gateway", () => {
    const config = Bun.YAML.parse(
      readFileSync("agentgateway/config.yaml", "utf8"),
    ) as any;
    const route = config.routes.find(
      (candidate: any) => candidate.name === "google-adk",
    );

    expect(route).toEqual({
      name: "google-adk",
      gateways: ["a2a"],
      matches: [{ path: { pathPrefix: "/a2a/google-adk" } }],
      policies: {
        a2a: {},
        urlRewrite: { path: { prefix: "/" } },
      },
      backends: [{ host: "google-adk-agent:8000" }],
    });
  });

  test("does not commit the Hermes OAuth secret or access token", () => {
    const files = [
      ".env.example",
      "compose.yaml",
      "services/hermes/config.yaml",
      "scripts/launch-hermes-tui.py",
    ];
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");

    expect(source).not.toContain("hermes-client-secret");
    expect(source).not.toMatch(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    );
    expect(readFileSync(".env.example", "utf8")).toContain(
      "HERMES_OAUTH_CLIENT_SECRET=",
    );
    expect(readFileSync(".gitignore", "utf8")).toContain(".openai-api-key");
    expect(readFileSync(".dockerignore", "utf8")).toContain("**/.venv");
  });
});
