import express from "express";
import { join } from "node:path";
import { DurableBinding } from "letta-a2a-bridge";
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
// Explicit opt-in only; the old ContextStore is never imported into durable state.
const durableDirectory = process.env.BRIDGE_DURABLE_DIRECTORY?.trim();
const runtimes: LettaRuntime[] = [];
const bindings: ReturnType<typeof createServiceBinding>[] = [];
const durableStates: DurableBinding[] = [];
try {
  for (const definition of definitions) {
    // Definition keys are validated path-safe by loadAgentDefinitions.
    const durability = durableDirectory
      ? await DurableBinding.open({
          directory: join(durableDirectory, definition.key),
          bindingId: JSON.stringify([
            definition.key,
            definition.appServerUrl,
            definition.displayName,
          ]),
        })
      : undefined;
    if (durability) durableStates.push(durability);
    const runtime = new LettaRuntime(
      definition,
      contextStore,
      model,
      turnTimeoutMs,
      a2aGatewayUrls,
      oauthTokenProvider,
      maximumA2AHops,
      {
        durability,
        credentialOwner: {
          issuer: auth.issuer,
          subject: oauthClientId,
          audience: auth.audience,
        },
      },
    );
    runtimes.push(runtime);
    bindings.push(
      createServiceBinding({
        definition,
        runtime,
        durability,
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
    await runtime.connect();
  }
} catch {
  await closeResources();
  throw new Error("Bridge runtime connection failed");
}

async function closeResources(): Promise<boolean> {
  // Drain actual runtime work before releasing storage. Attached durable owners
  // refuse close if the binding cannot prove complete shutdown.
  const bindingClosing = bindings.map((binding) => binding.close());
  const runtimeClosing = runtimes.map((runtime) => runtime.close());
  const [runtimeResults, bindingResults] = await Promise.all([
    Promise.allSettled(runtimeClosing),
    Promise.allSettled(bindingClosing),
  ]);
  const stateResults = await Promise.allSettled(
    durableStates.map((state) => state.close()),
  );
  contextStore.close();
  return (
    runtimeResults.every((result) => result.status === "fulfilled") &&
    bindingResults.every(
      (result) => result.status === "fulfilled" && result.value.complete,
    ) &&
    stateResults.every((result) => result.status === "fulfilled")
  );
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
    void closeResources().then(
      (complete) => {
        server.closeAllConnections();
        clearTimeout(deadline);
        process.exit(complete ? 0 : 1);
      },
      () => {
        server.closeAllConnections();
        clearTimeout(deadline);
        process.exit(1);
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
