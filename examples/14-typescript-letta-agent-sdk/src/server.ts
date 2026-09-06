import express from "express";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import { LettaAgentClient } from "@letta-ai/letta-agent-sdk";

import { createAgentCard } from "./agent-card.js";
import { loadConfig } from "./config.js";
import {
  AgentSdkTurnRunner,
  resolveOrCreateAgent,
} from "./letta-agent.js";
import { LettaAgentExecutor } from "./letta-agent-executor.js";

const config = loadConfig();
const lettaClient = new LettaAgentClient({ backend: "local" });
const agentId = await resolveOrCreateAgent(lettaClient, config);

const executor = new LettaAgentExecutor(
  new AgentSdkTurnRunner(
    lettaClient,
    agentId,
    config.lettaWorkingDirectory,
  ),
);
const requestHandler = new DefaultRequestHandler(
  createAgentCard(config.publicBaseUrl),
  new InMemoryTaskStore(),
  executor,
);

const app = express();
app.disable("x-powered-by");
app.get("/healthz", (_request, response) => {
  response.json({ status: "ok", agentId });
});
app.use(
  `/${AGENT_CARD_PATH}`,
  agentCardHandler({ agentCardProvider: requestHandler }),
);
app.use(
  "/",
  jsonRpcHandler({
    requestHandler,
    userBuilder: UserBuilder.noAuthentication,
    // A2A 1.0 only: legacyCompat is intentionally not enabled.
  }),
);

const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`Letta agent: ${agentId}`);
  console.log(`A2A endpoint: ${config.publicBaseUrl}/`);
  console.log(
    `Agent Card: ${config.publicBaseUrl}/${AGENT_CARD_PATH}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    executor.close();
    server.close(() => process.exit(0));
  });
}
