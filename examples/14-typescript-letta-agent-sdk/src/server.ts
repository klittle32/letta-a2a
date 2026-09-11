import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { join } from "node:path";
import { LettaAgentClient } from "@letta-ai/letta-agent-sdk";
import {
  createBridge,
  createToolPolicy,
  listenLoopback,
} from "letta-a2a-bridge";
import { createA2AClient, FileContextStore } from "letta-a2a-client";
import { createA2ATools } from "letta-a2a-client/agent-sdk";
import { loadConfig } from "./config.js";
import { resolveOrCreateAgent } from "./letta-agent.js";
import { createA2ASessionOptions } from "./tool-policy.js";

const config = loadConfig();
const outbound = config.outboundRoutes
  ? createA2AClient({
      routes: config.outboundRoutes,
      contextStore: new FileContextStore(
        join(
          config.lettaWorkingDirectory,
          ".letta",
          "a2a-client-contexts.json",
        ),
      ),
    })
  : undefined;
const lettaClient = new LettaAgentClient({ backend: "local" });
const agentId = await resolveOrCreateAgent(lettaClient, config);
const bridge = createBridge({
  client: lettaClient,
  agentId,
  sharingDomain: "example-14-local",
  publicBaseUrl: config.publicBaseUrl,
  name: "Letta Agent SDK Example",
  sessionOptions(scope) {
    if (config.clientAdapter === "mod") {
      return { options: createA2ASessionOptions(config.lettaWorkingDirectory) };
    }
    if (!outbound) {
      return {
        options: { ...createToolPolicy(), cwd: config.lettaWorkingDirectory },
      };
    }
    const tools = createA2ATools({
      client: outbound,
      getScope: () => scope,
      signal: scope.signal,
    });
    return {
      options: {
        ...createA2ASessionOptions(config.lettaWorkingDirectory),
        tools: tools.tools,
      },
      close: () => tools.close(),
    };
  },
});
const listener = await listenLoopback(bridge, { port: config.port });
console.log(`Letta agent: ${agentId}`);
console.log(`A2A endpoint: ${listener.url}/`);
console.log(`Agent Card: ${listener.url}/${AGENT_CARD_PATH}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void listener
      .close()
      .then((result) => {
        if (!result.complete) {
          console.error(
            "Bridge cleanup incomplete; execution may still be active",
            result,
          );
          process.exitCode = 1;
        }
      })
      .finally(() => outbound?.close());
  });
}
