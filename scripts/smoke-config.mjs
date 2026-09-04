export function resolveSmokeEndpoints(environment = process.env) {
  const gatewayPort = value(environment.A2A_GATEWAY_PORT, "4000");
  const oauthPort = value(environment.OAUTH_PORT, "9001");
  return {
    baseUrl: value(
      environment.A2A_GATEWAY_URL,
      `http://127.0.0.1:${gatewayPort}`,
    ).replace(/\/$/, ""),
    oauthTokenUrl: value(
      environment.OAUTH_TOKEN_URL,
      `http://127.0.0.1:${oauthPort}/token`,
    ),
  };
}

function value(candidate, fallback) {
  return candidate?.trim() || fallback;
}
