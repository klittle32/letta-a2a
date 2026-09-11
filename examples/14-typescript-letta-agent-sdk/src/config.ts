export interface ExampleConfig {
  port: number;
  publicBaseUrl: string;
  lettaAgentId?: string;
  lettaAgentName: string;
  lettaModel?: string;
  lettaWorkingDirectory: string;
  clientAdapter: "sdk" | "mod";
  outboundRoutes?: Record<string, string>;
}

export function loadConfig(environment = process.env): ExampleConfig {
  const port = parsePort(environment.PORT);
  const clientAdapter = environment.A2A_CLIENT_ADAPTER ?? "sdk";
  if (clientAdapter !== "sdk" && clientAdapter !== "mod") {
    throw new Error("A2A_CLIENT_ADAPTER must be sdk or mod");
  }
  if (clientAdapter === "mod" && environment.A2A_REMOTE_ROUTES !== undefined) {
    throw new Error(
      "A2A_REMOTE_ROUTES configures SDK tools; mod mode uses its own Letta configuration",
    );
  }

  return {
    port,
    clientAdapter,
    outboundRoutes: parseRoutes(environment.A2A_REMOTE_ROUTES),
    publicBaseUrl: (
      environment.A2A_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`
    ).replace(/\/$/, ""),
    lettaAgentId: optional(environment.A2A_LETTA_AGENT_ID),
    lettaAgentName:
      optional(environment.A2A_LETTA_AGENT_NAME) ??
      "A2A TypeScript Example Agent",
    lettaModel: optional(environment.A2A_LETTA_MODEL),
    lettaWorkingDirectory:
      optional(environment.A2A_LETTA_WORKING_DIRECTORY) ?? process.cwd(),
  };
}

function parseRoutes(
  raw: string | undefined,
): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  const routes: unknown = JSON.parse(raw);
  if (
    !routes ||
    typeof routes !== "object" ||
    Array.isArray(routes) ||
    Object.values(routes).some((value) => typeof value !== "string")
  ) {
    throw new Error(
      "A2A_REMOTE_ROUTES must be a JSON object mapping names to URLs",
    );
  }
  return routes as Record<string, string>;
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
