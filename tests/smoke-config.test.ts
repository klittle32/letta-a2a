import { describe, expect, test } from "bun:test";

import { resolveSmokeEndpoints } from "../scripts/smoke-config.mjs";

describe("smoke client host endpoints", () => {
  test("uses host-port defaults that avoid the auth server's internal port", () => {
    expect(resolveSmokeEndpoints({})).toEqual({
      baseUrl: "http://127.0.0.1:4000",
      oauthTokenUrl: "http://127.0.0.1:9001/token",
    });
  });

  test("honors configured ports and explicit URL overrides", () => {
    expect(
      resolveSmokeEndpoints({
        A2A_GATEWAY_PORT: "4100",
        OAUTH_PORT: "9100",
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:4100",
      oauthTokenUrl: "http://127.0.0.1:9100/token",
    });
    expect(
      resolveSmokeEndpoints({
        A2A_GATEWAY_PORT: "4100",
        OAUTH_PORT: "9100",
        A2A_GATEWAY_URL: "https://gateway.example/a2a",
        OAUTH_TOKEN_URL: "https://issuer.example/token",
      }),
    ).toEqual({
      baseUrl: "https://gateway.example/a2a",
      oauthTokenUrl: "https://issuer.example/token",
    });
  });
});
