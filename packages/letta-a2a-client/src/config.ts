import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface A2AClientConfig {
  routes: Record<string, string>;
  pollIntervalMs: number;
  timeoutMs: number;
  contextStorePath: string;
}

interface RawConfig {
  routes?: unknown;
  pollIntervalMs?: unknown;
  timeoutMs?: unknown;
  contextStorePath?: unknown;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): A2AClientConfig {
  const configPath =
    environment.LETTA_A2A_CONFIG ?? join(home, ".letta", "a2a-client.json");
  let raw: RawConfig = {};

  if (existsSync(configPath)) {
    raw = parseJson(readFileSync(configPath, "utf8"), configPath) as RawConfig;
  } else if (!environment.LETTA_A2A_ROUTES) {
    throw new Error(
      `A2A routes are not configured. Create ${configPath} or set LETTA_A2A_ROUTES.`,
    );
  }

  if (environment.LETTA_A2A_ROUTES) {
    raw.routes = parseJson(environment.LETTA_A2A_ROUTES, "LETTA_A2A_ROUTES");
  }
  if (environment.LETTA_A2A_CONTEXT_STORE) {
    raw.contextStorePath = environment.LETTA_A2A_CONTEXT_STORE;
  }

  return parseConfig(raw, home);
}

export function parseConfig(raw: unknown, home: string): A2AClientConfig {
  if (!isRecord(raw)) throw new Error("A2A configuration must be a JSON object");
  if (!isRecord(raw.routes) || Object.keys(raw.routes).length === 0) {
    throw new Error("A2A configuration must contain at least one route");
  }

  const routes: Record<string, string> = {};
  for (const [target, value] of Object.entries(raw.routes)) {
    if (!/^[A-Za-z0-9._-]+$/.test(target)) {
      throw new Error(`A2A route name ${JSON.stringify(target)} is invalid`);
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`A2A route ${JSON.stringify(target)} must be a URL string`);
    }
    routes[target] = normalizeRouteUrl(target, value);
  }

  const contextStorePath = readOptionalString(
    raw.contextStorePath,
    "contextStorePath",
  );

  return {
    routes,
    pollIntervalMs: readInteger(
      raw.pollIntervalMs,
      500,
      50,
      5_000,
      "pollIntervalMs",
    ),
    timeoutMs: readInteger(
      raw.timeoutMs,
      120_000,
      1_000,
      600_000,
      "timeoutMs",
    ),
    contextStorePath: contextStorePath
      ? isAbsolute(contextStorePath)
        ? contextStorePath
        : resolve(home, contextStorePath)
      : join(home, ".letta", "a2a-client-contexts.json"),
  };
}

function normalizeRouteUrl(target: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`A2A route ${JSON.stringify(target)} is not a valid URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`A2A route ${JSON.stringify(target)} must use http or https`);
  }
  if (url.username || url.password) {
    throw new Error(
      `A2A route ${JSON.stringify(target)} must not contain credentials`,
    );
  }
  if (url.search || url.hash) {
    throw new Error(
      `A2A route ${JSON.stringify(target)} must not contain a query or fragment`,
    );
  }

  return url.href.replace(/\/$/, "");
}

function readInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function readOptionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
