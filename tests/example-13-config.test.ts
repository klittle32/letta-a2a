import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Example 13 OAuth identity slice", () => {
  test("wires only optional harness identities into the existing auth server", () => {
    const compose = Bun.YAML.parse(readFileSync("compose.yaml", "utf8")) as any;
    const auth = compose.services["auth-server"];

    expect(auth.environment.OAUTH_LETTA_CODE_CLIENT_ID).toBe(
      "${OAUTH_LETTA_CODE_CLIENT_ID:-letta-code-client}",
    );
    expect(auth.environment.OAUTH_LETTA_CODE_CLIENT_SECRET).toBe(
      "${OAUTH_LETTA_CODE_CLIENT_SECRET:-}",
    );
    expect(auth.environment.OAUTH_CODEX_CLIENT_ID).toBe(
      "${OAUTH_CODEX_CLIENT_ID:-codex-client}",
    );
    expect(auth.environment.OAUTH_CODEX_CLIENT_SECRET).toBe(
      "${OAUTH_CODEX_CLIENT_SECRET:-}",
    );

    for (const [name, service] of Object.entries(compose.services) as any) {
      if (name === "auth-server") continue;
      expect(service.environment?.OAUTH_LETTA_CODE_CLIENT_ID).toBeUndefined();
      expect(
        service.environment?.OAUTH_LETTA_CODE_CLIENT_SECRET,
      ).toBeUndefined();
      expect(service.environment?.OAUTH_CODEX_CLIENT_ID).toBeUndefined();
      expect(service.environment?.OAUTH_CODEX_CLIENT_SECRET).toBeUndefined();
    }
  });

  test("reuses Example 12 profiles, service, route, and networks", () => {
    const compose = Bun.YAML.parse(readFileSync("compose.yaml", "utf8")) as any;
    const gateway = Bun.YAML.parse(
      readFileSync("agentgateway/config.yaml", "utf8"),
    ) as any;

    expect(compose.services["google-adk-agent"].profiles).toEqual([
      "example-12",
      "example-12-live",
    ]);
    expect(compose.services["google-adk-agent"].networks).toEqual(["a2a-lab"]);
    expect(Object.keys(compose.networks).sort()).toEqual([
      "a2a-clients",
      "a2a-lab",
    ]);
    expect(
      gateway.routes.filter((route: any) => route.name === "google-adk"),
    ).toEqual([
      {
        name: "google-adk",
        gateways: ["a2a"],
        matches: [{ path: { pathPrefix: "/a2a/google-adk" } }],
        policies: {
          a2a: {},
          urlRewrite: { path: { prefix: "/" } },
        },
        backends: [{ host: "google-adk-agent:8000" }],
      },
    ]);
  });

  test("keeps both Example 13 secrets intentionally blank", () => {
    const env = readFileSync(".env.example", "utf8");
    const compose = readFileSync("compose.yaml", "utf8");

    expect(env).toMatch(/^OAUTH_LETTA_CODE_CLIENT_SECRET=$/m);
    expect(env).toMatch(/^OAUTH_CODEX_CLIENT_SECRET=$/m);
    expect(compose).toContain("OAUTH_LETTA_CODE_CLIENT_SECRET:-}");
    expect(compose).toContain("OAUTH_CODEX_CLIENT_SECRET:-}");
    expect(`${env}\n${compose}`).not.toMatch(
      /OAUTH_(?:LETTA_CODE|CODEX)_CLIENT_SECRET=(?!\s*$).+/m,
    );
  });
});
