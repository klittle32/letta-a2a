export interface AgentDefinition {
  key: string;
  displayName: string;
  appServerUrl: string;
  appServerToken: string;
  publicBaseUrl?: string;
}

export type GatewayUrls = Record<string, string>;

const AGENT_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function loadAgentDefinitions(raw: string | undefined): AgentDefinition[] {
  if (!raw?.trim()) {
    throw new Error("AGENT_DEFINITIONS is required");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`AGENT_DEFINITIONS is not valid JSON: ${String(error)}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("AGENT_DEFINITIONS must be a non-empty array");
  }

  const seen = new Set<string>();
  const seenDisplayNames = new Set<string>();
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`agent definition ${index} must be an object`);
    }

    const record = entry as Record<string, unknown>;
    const definition: AgentDefinition = {
      key: requiredString(record.key, `agent definition ${index}.key`),
      displayName: requiredString(
        record.displayName,
        `agent definition ${index}.displayName`,
      ),
      appServerUrl: requiredString(
        record.appServerUrl,
        `agent definition ${index}.appServerUrl`,
      ),
      appServerToken: requiredString(
        record.appServerToken,
        `agent definition ${index}.appServerToken`,
      ),
      publicBaseUrl:
        typeof record.publicBaseUrl === "string" && record.publicBaseUrl.trim()
          ? record.publicBaseUrl.trim().replace(/\/$/, "")
          : undefined,
    };

    if (!AGENT_KEY_PATTERN.test(definition.key)) {
      throw new Error(
        `agent definition ${index}.key must contain lowercase letters, numbers, and hyphens`,
      );
    }
    if (seen.has(definition.key)) {
      throw new Error(`duplicate agent key: ${definition.key}`);
    }
    seen.add(definition.key);
    if (seenDisplayNames.has(definition.displayName)) {
      throw new Error(`duplicate agent display name: ${definition.displayName}`);
    }
    seenDisplayNames.add(definition.displayName);

    const url = new URL(definition.appServerUrl);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new Error(`${definition.key}.appServerUrl must use ws:// or wss://`);
    }

    return definition;
  });
}

export function loadGatewayUrls(
  raw: string | undefined,
  definitions: readonly AgentDefinition[],
): GatewayUrls {
  if (!raw) throw new Error("A2A_GATEWAY_URLS is required");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("A2A_GATEWAY_URLS must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("A2A_GATEWAY_URLS must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  return Object.fromEntries(
    definitions.map((definition) => {
      const value = record[definition.key];
      if (typeof value !== "string" || !/^https?:\/\//.test(value)) {
        throw new Error(
          `A2A_GATEWAY_URLS must include an HTTP URL for ${definition.key}`,
        );
      }
      return [definition.key, value.replace(/\/$/, "")];
    }),
  );
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}
