import { homedir } from "node:os";
import type { ReasoningEffort } from "@letta-ai/letta-agent-sdk";

export interface ScooterConfig {
  port: number;
  /** Provider/model handle; the SDK passes any handle containing "/" through. */
  model: string;
  reasoningEffort: ReasoningEffort;
  agentName: string;
  workingDirectory: string;
  /** exe.dev VM names allowed to call A2A methods. Empty disables the check. */
  allowedSourceVms: Set<string>;
}

const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export function loadConfig(environment = process.env): ScooterConfig {
  const reasoning = optional(environment.SCOOTER_REASONING) ?? "high";
  if (!REASONING_EFFORTS.includes(reasoning as ReasoningEffort)) {
    throw new Error(
      `SCOOTER_REASONING must be one of ${REASONING_EFFORTS.join(", ")}`,
    );
  }
  const model = optional(environment.SCOOTER_MODEL) ?? "openai/gpt-6-luna";
  if (!model.includes("/")) {
    // Catalog ids such as "gpt-6-luna-high" are rejected by createAgent.
    throw new Error(
      "SCOOTER_MODEL must be a provider/model handle, e.g. openai/gpt-6-luna",
    );
  }
  return {
    port: parsePort(environment.PORT),
    model,
    reasoningEffort: reasoning as ReasoningEffort,
    agentName: optional(environment.SCOOTER_AGENT_NAME) ?? "Scooter",
    workingDirectory:
      optional(environment.SCOOTER_WORKDIR) ?? `${homedir()}/scooter-workspace`,
    allowedSourceVms: new Set(
      (environment.ALLOWED_SOURCE_VMS ?? "")
        .split(",")
        .map((vm) => vm.trim())
        .filter(Boolean),
    ),
  };
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 8000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
