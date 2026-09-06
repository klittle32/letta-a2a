export interface ExampleConfig {
  port: number;
  publicBaseUrl: string;
  lettaAgentId?: string;
  lettaAgentName: string;
  lettaModel?: string;
  lettaWorkingDirectory: string;
}

export function loadConfig(environment = process.env): ExampleConfig {
  const port = parsePort(environment.PORT);

  return {
    port,
    publicBaseUrl: (environment.A2A_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`).replace(
      /\/$/,
      "",
    ),
    lettaAgentId: optional(environment.A2A_LETTA_AGENT_ID),
    lettaAgentName:
      optional(environment.A2A_LETTA_AGENT_NAME) ??
      "A2A TypeScript Example Agent",
    lettaModel: optional(environment.A2A_LETTA_MODEL),
    lettaWorkingDirectory:
      optional(environment.A2A_LETTA_WORKING_DIRECTORY) ?? process.cwd(),
  };
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 41241;

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
