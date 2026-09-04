import express from "express";
import {
  AGENT_CARD_PATH,
} from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";

import { loadAgentDefinitions, loadGatewayUrls } from "./config.js";
import { ContextStore } from "./context-store.js";
import { LettaAgentExecutor } from "./executor.js";
import { LettaRuntime } from "./letta-runtime.js";
import { createAgentCard, serializeAgentCard } from "./mapping.js";
import { ClientCredentialsTokenProvider } from "./oauth-client.js";
import {
  LabPushNotificationSender,
  ValidatingPushNotificationStore,
} from "./push-notifications.js";

const port = positiveInteger(process.env.PORT, 8080, "PORT");
const turnTimeoutMs = positiveInteger(
  process.env.TURN_TIMEOUT_MS,
  120_000,
  "TURN_TIMEOUT_MS",
);
const maximumA2AHops = positiveInteger(
  process.env.MAX_A2A_HOPS,
  1,
  "MAX_A2A_HOPS",
);
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
const oauthTokenProvider = new ClientCredentialsTokenProvider({
  tokenUrl: requiredEnvironment("OAUTH_TOKEN_URL"),
  clientId: requiredEnvironment("OAUTH_CLIENT_ID"),
  clientSecret: requiredEnvironment("OAUTH_CLIENT_SECRET"),
  scope: requiredEnvironment("OAUTH_SCOPE"),
});
const oauthPublicBaseUrl = requiredEnvironment("OAUTH_PUBLIC_BASE_URL").replace(
  /\/$/,
  "",
);
const pushCallbackUrl = requiredEnvironment("PUSH_CALLBACK_URL");
const pushCallbackToken = requiredEnvironment("PUSH_CALLBACK_TOKEN");

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
    ),
);

await Promise.all(runtimes.map((runtime) => runtime.connect()));

const app = express();
app.disable("x-powered-by");
app.get("/healthz", (_request, response) => {
  response.json({ status: "ok", agents: definitions.map((agent) => agent.key) });
});

for (const runtime of runtimes) {
  const definition = runtime.definition as typeof runtime.definition & {
    publicBaseUrl: string;
  };
  const card = createAgentCard(definition, {
    tokenUrl: `${oauthPublicBaseUrl}/token`,
    metadataUrl: `${oauthPublicBaseUrl}/.well-known/oauth-authorization-server`,
    availableScopes: {
      "a2a.discover": "Discover an A2A agent through the lab gateway.",
      "a2a.invoke": "Invoke an A2A agent through the lab gateway.",
    },
    requiredScopes: ["a2a.invoke"],
  });
  const pushStore = new ValidatingPushNotificationStore(
    pushCallbackUrl,
    pushCallbackToken,
  );
  const handler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    new LettaAgentExecutor(runtime),
    undefined,
    pushStore,
    new LabPushNotificationSender(pushStore),
  );
  const router = express.Router();
  router.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({
      agentCardProvider: async () => serializeAgentCard(card) as typeof card,
    }),
  );
  router.use(
    "/",
    jsonRpcHandler({
      requestHandler: handler,
      userBuilder: UserBuilder.noAuthentication,
      legacyCompat: { enabled: true },
    }),
  );
  app.use(`/agents/${definition.key}`, router);
}

const server = app.listen(port, "0.0.0.0", () => {
  console.log(
    `Letta A2A bridge listening on port ${port} for ${definitions.map((agent) => agent.key).join(", ")}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      for (const runtime of runtimes) runtime.close();
      contextStore.close();
      process.exit(0);
    });
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
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
