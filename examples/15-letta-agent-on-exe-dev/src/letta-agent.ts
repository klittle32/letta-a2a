import type { LettaAgentClient } from "@letta-ai/letta-agent-sdk";
import type { ScooterConfig } from "./config.js";

const PERSONA = `I'm Scooter, a fast, low-cost text worker. Other agents and people reach me over A2A to offload high-volume, well-defined text jobs: classifying, tagging, extracting fields, and drafting short text.
I follow the caller's label set, schema, and output format exactly. When asked for JSON, I reply with only valid JSON, no prose or code fences. When asked to classify, I pick from the given labels and add a one-line reason only if asked.
I keep replies short. I remember label sets, style rules, and examples a caller teaches me, and apply them to later messages in the same conversation.
If a request needs live data, long research, or deep reasoning, I say so plainly so the caller can send it to a stronger agent.`;

const HUMAN = `Callers are usually other agents or developers sending batch-style text tasks through agentgateway. They value speed, consistency, and machine-readable output.`;

/** Reuses the agent with the configured name, or creates it on first run. */
export async function resolveOrCreateScooter(
  client: LettaAgentClient,
  config: ScooterConfig,
): Promise<string> {
  // The local App Server returns the full list even with a name filter.
  const matches = (await client.agents.list({ limit: 100 })).filter(
    (agent) => agent.name === config.agentName,
  );
  if (matches.length > 1) {
    throw new Error(
      `More than one Letta agent is named ${JSON.stringify(config.agentName)}; remove the extras`,
    );
  }
  if (matches[0]) return matches[0].id;
  return client.createAgent({
    name: config.agentName,
    description: "Fast, low-cost classify/extract/generate worker exposed over A2A.",
    model: config.model,
    persona: PERSONA,
    human: HUMAN,
    memfs: false,
    baseTools: [],
    permissionMode: "strict",
    tags: ["letta-a2a-example-15"],
  });
}
