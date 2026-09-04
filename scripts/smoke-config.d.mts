export interface SmokeEndpoints {
  baseUrl: string;
  oauthTokenUrl: string;
}

export function resolveSmokeEndpoints(
  environment?: Record<string, string | undefined>,
): SmokeEndpoints;
