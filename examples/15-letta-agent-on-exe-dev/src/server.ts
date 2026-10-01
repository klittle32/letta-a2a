import { mkdirSync } from "node:fs";
import express from "express";
import { LettaAgentClient } from "@letta-ai/letta-agent-sdk";
import {
  createBridge,
  createBridgeRouter,
  createToolPolicy,
} from "letta-a2a-bridge";
import { applyScooterCard, GATEWAY_API_KEY_SECURITY } from "./card.js";
import { loadConfig } from "./config.js";
import { resolveOrCreateScooter } from "./letta-agent.js";
import { sourceVmGuard } from "./source-vm-guard.js";

const config = loadConfig();
const client = new LettaAgentClient({ backend: "local" });
const agentId = await resolveOrCreateScooter(client, config);
mkdirSync(config.workingDirectory, { recursive: true });

const bridge = createBridge({
  client,
  agentId,
  sharingDomain: "example-15-scooter",
  // Anonymous bridges require a loopback origin. agentgateway rewrites the
  // card's interface URL to its own public address.
  publicBaseUrl: `http://127.0.0.1:${config.port}`,
  name: config.agentName,
  security: GATEWAY_API_KEY_SECURITY,
  // No tools: createToolPolicy() keeps the session strict and denies every
  // tool request. Model and reasoning apply to each turn's session.
  sessionOptions: () => ({
    options: {
      ...createToolPolicy(),
      cwd: config.workingDirectory,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
    },
  }),
});
applyScooterCard(bridge.card);

// listenLoopback binds 127.0.0.1 only; exe.dev's proxy needs all interfaces.
// The guard is what keeps callers other than the gateway out.
const app = express();
app.disable("x-powered-by");
app.use(sourceVmGuard(config.allowedSourceVms));
app.use(createBridgeRouter(bridge));
const server = app.listen(config.port, "0.0.0.0");
await new Promise<void>((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
console.log(
  `${config.agentName} (${agentId}) on :${config.port}, model ${config.model}, reasoning ${config.reasoningEffort}`,
);
console.log(
  `Allowed source VMs: ${[...config.allowedSourceVms].join(", ") || "any"}`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void bridge.close().then((result) => {
      if (!result.complete) {
        console.error(
          "Bridge cleanup incomplete; a turn may still be active",
          result,
        );
        process.exitCode = 1;
      }
      server.closeAllConnections();
    });
  });
}
