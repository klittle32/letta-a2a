import express from "express";
import { loadAgentDefinitions, loadGatewayUrls } from "./config.js";
import { ContextStore } from "./context-store.js";
import { LettaRuntime } from "./letta-runtime.js";
import { ClientCredentialsTokenProvider } from "./oauth-client.js";
import { createServiceBinding } from "./service-binding.js";

const port = positiveInteger(process.env.PORT, 8080, "PORT");
const turnTimeoutMs = positiveInteger(
  process.env.TURN_TIMEOUT_MS,
  120_000,
  "TURN_TIMEOUT_MS",
);
const shutdownTimeoutMs = positiveInteger(
  process.env.SHUTDOWN_TIMEOUT_MS,
  5000,
  "SHUTDOWN_TIMEOUT_MS",
);
const maximumA2AHops = positiveInteger(
  process.env.MAX_A2A_HOPS,
  1,
  "MAX_A2A_HOPS",
);
if (maximumA2AHops > 32) throw new Error("MAX_A2A_HOPS must not exceed 32");
const model = requiredEnvironment("LETTA_TEST_MODEL");
const publicBaseUrl = (
  process.env.BRIDGE_PUBLIC_BASE_URL ?? `http://bridge:${port}`
).replace(/\/$/, "");
const contextStore = new ContextStore(
  process.env.CONTEXT_STORE_PATH ?? "/data/contexts.json",
);
const definitions = loadAgentDefinitions(process.env.AGENT_DEFINITIONS).map(
  (definition) => ({
    ...definition,
    publicBaseUrl: definition.publicBaseUrl ?? publicBaseUrl,
  }),
);
const a2aGatewayUrls = loadGatewayUrls(
  process.env.A2A_GATEWAY_URLS,
  definitions,
);
const tokenUrl = requiredEnvironment("OAUTH_TOKEN_URL");
const oauthClientId = requiredEnvironment("OAUTH_CLIENT_ID");
const oauthTokenProvider = new ClientCredentialsTokenProvider({
  tokenUrl,
  clientId: oauthClientId,
  clientSecret: requiredEnvironment("OAUTH_CLIENT_SECRET"),
  scope: requiredEnvironment("OAUTH_SCOPE"),
});
const oauthPublicBaseUrl = requiredEnvironment("OAUTH_PUBLIC_BASE_URL").replace(
  /\/$/,
  "",
);
const auth = {
  issuer: process.env.OAUTH_ISSUER ?? oauthPublicBaseUrl,
  audience: process.env.OAUTH_AUDIENCE ?? "letta-a2a-gateway",
  jwksUrl: process.env.OAUTH_JWKS_URL ?? new URL("/jwks", tokenUrl).href,
  maximumHops: maximumA2AHops,
};
const push = {
  callbacks: [
    {
      url: requiredEnvironment("PUSH_CALLBACK_URL"),
      bearerToken: requiredEnvironment("PUSH_CALLBACK_TOKEN"),
    },
  ],
};
const runtimes = definitions.map(
  (definition) =>
    new LettaRuntime(
      definition,
      contextStore,
      model,
      turnTimeoutMs,
      a2aGatewayUrls,
      oauthTokenProvider,
      maximumA2AHops,
      {
        credentialOwner: {
          issuer: auth.issuer,
          subject: oauthClientId,
          audience: auth.audience,
        },
      },
    ),
);
const bindings = definitions.map((definition, index) =>
  createServiceBinding({
    definition,
    runtime: runtimes[index]!,
    auth,
    push,
    shutdownTimeoutMs,
    oauth: {
      tokenUrl: `${oauthPublicBaseUrl}/token`,
      metadataUrl: `${oauthPublicBaseUrl}/.well-known/oauth-authorization-server`,
      availableScopes: {
        "a2a.discover": "Discover an A2A agent through the lab gateway.",
        "a2a.invoke": "Invoke an A2A agent through the lab gateway.",
      },
      requiredScopes: ["a2a.invoke"],
    },
  }),
);
try {
  await Promise.all(runtimes.map((runtime) => runtime.connect()));
} catch {
  await Promise.allSettled(bindings.map((binding) => binding.close()));
  for (const runtime of runtimes) runtime.close?.();
  contextStore.close();
  throw new Error("Bridge runtime connection failed");
}
const app = express();
app.disable("x-powered-by");
app.get("/healthz", (_request, response) => {
  response.json({
    status: "ok",
    agents: definitions.map((agent) => agent.key),
  });
});
for (const binding of bindings) app.use(binding.mountPath, binding.router);
const server = app.listen(port, "0.0.0.0", () => {
  console.log(
    `Letta A2A bridge listening on port ${port} for ${definitions.map((agent) => agent.key).join(", ")}`,
  );
});
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    server.close();
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, shutdownTimeoutMs + 1000);
    void Promise.allSettled(bindings.map((binding) => binding.close())).then(
      (results) => {
        server.closeAllConnections();
        for (const runtime of runtimes) runtime.close?.();
        contextStore.close();
        clearTimeout(deadline);
        process.exit(
          results.every(
            (result) => result.status === "fulfilled" && result.value.complete,
          )
            ? 0
            : 1,
        );
      },
    );
  });
}
function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function positiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}
