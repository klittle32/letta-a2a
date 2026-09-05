export const OAUTH_SCOPE: "a2a.discover a2a.invoke";

export type PublicCommand =
  | { command: "card" }
  | { command: "send"; text: string; contextId?: string }
  | { command: "get-task" | "cancel-task"; taskId: string };

export interface LauncherConfig {
  binary: string;
  gatewayUrl: string;
  tokenUrl: string;
  clientId: string;
  secretFile: string;
  cacheDir: string;
  scope: string;
}

export interface CachedAccessToken {
  clientId: string;
  tokenUrl: string;
  scope: string;
  gatewayUrl: string;
  accessToken: string;
  expiresAtMs: number;
}

export interface LauncherResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function parsePublicArgs(arguments_: string[]): PublicCommand;
export function buildCliArgs(baseUrl: string, command: PublicCommand): string[];
export function validateConfig(
  environment?: Record<string, string | undefined>,
): LauncherConfig;
export function cacheIdentity(config: LauncherConfig): string;
export function getAccessToken(
  config: LauncherConfig,
  options?: {
    now?: number;
    oauthTimeoutMs?: number;
    oauthResponseLimit?: number;
    fetchImpl?: FetchLike;
  },
): Promise<CachedAccessToken>;
export function invalidateCache(config: LauncherConfig): void;
export function runLauncher(
  arguments_: string[],
  environment?: Record<string, string | undefined>,
  options?: {
    now?: number;
    oauthTimeoutMs?: number;
    oauthResponseLimit?: number;
    fetchImpl?: FetchLike;
    childTimeoutMs?: number;
    stdoutLimit?: number;
    stderrLimit?: number;
  },
): Promise<LauncherResult>;
