import type { LettaAgentClient } from "@letta-ai/letta-agent-sdk";
import type { ExampleConfig } from "./config.js";
import { assertNoPersistedAgentTools } from "./tool-policy.js";

/** Agent creation/reuse is explicitly demo setup, never a library import effect. */
export async function resolveOrCreateAgent(
  client: LettaAgentClient,
  config: ExampleConfig,
): Promise<string> {
  if (config.lettaAgentId) {
    const agent = await client.agents.retrieve(config.lettaAgentId);
    assertNoPersistedAgentTools(agent);
    return agent.id;
  }
  // The local App Server currently returns the full list even with a name filter.
  const matches = (await client.agents.list({ limit: 100 })).filter(
    (agent) => agent.name === config.lettaAgentName,
  );
  if (matches.length > 1) {
    throw new Error(
      `More than one Letta agent is named ${JSON.stringify(config.lettaAgentName)}; set A2A_LETTA_AGENT_ID explicitly`,
    );
  }
  if (matches[0]) {
    const agent = await client.agents.retrieve(matches[0].id);
    assertNoPersistedAgentTools(agent);
    return agent.id;
  }
  return client.createAgent({
    name: config.lettaAgentName,
    description: "A local Letta agent exposed by A2A Example 14.",
    ...(config.lettaModel ? { model: config.lettaModel } : {}),
    persona:
      "You are a concise assistant exposed through an A2A server. Preserve useful context across turns. When explicitly asked to consult a configured remote A2A target, use a2a_invoke and report its result.",
    human:
      "The caller is learning how A2A context maps to a persistent Letta conversation.",
    memfs: false,
    baseTools: [],
    permissionMode: "strict",
    tags: ["letta-a2a-example-14"],
  });
}
