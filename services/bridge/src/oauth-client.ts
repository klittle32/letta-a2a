export interface AccessTokenProvider {
  getAccessToken(signal?: AbortSignal): Promise<string>;
}

export interface ClientCredentialsConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  refreshSkewMs?: number;
  exchangeTimeoutMs?: number;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface CachedToken {
  value: string;
  expiresAtMs: number;
}

export class ClientCredentialsTokenProvider implements AccessTokenProvider {
  private cached?: CachedToken;
  private exchangeInFlight?: Promise<CachedToken>;

  constructor(
    private readonly config: ClientCredentialsConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly clock: () => number = Date.now,
  ) {
    const tokenUrl = new URL(config.tokenUrl);
    if (tokenUrl.protocol !== "http:" && tokenUrl.protocol !== "https:") {
      throw new Error("OAuth token URL must use HTTP(S)");
    }
    if (!config.clientId || !config.clientSecret || !config.scope) {
      throw new Error("OAuth client ID, client secret, and scope are required");
    }
  }

  async getAccessToken(signal?: AbortSignal): Promise<string> {
    const refreshSkewMs = this.config.refreshSkewMs ?? 5_000;
    if (
      this.cached &&
      this.cached.expiresAtMs > this.clock() + refreshSkewMs
    ) {
      return this.cached.value;
    }

    if (!this.exchangeInFlight) {
      this.exchangeInFlight = this.exchange(
        AbortSignal.timeout(this.config.exchangeTimeoutMs ?? 10_000),
      )
        .then((token) => {
          this.cached = token;
          return token;
        })
        .finally(() => {
          this.exchangeInFlight = undefined;
        });
    }
    const token = await waitForCaller(this.exchangeInFlight, signal);
    return token.value;
  }

  private async exchange(signal?: AbortSignal): Promise<CachedToken> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: this.config.scope,
    });
    const encodedCredentials = Buffer.from(
      `${formEncode(this.config.clientId)}:${formEncode(this.config.clientSecret)}`,
      "utf8",
    ).toString("base64");
    const response = await this.fetchImpl(this.config.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${encodedCredentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal,
    });
    const rawBody = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      if (!response.ok) {
        throw new Error(`OAuth token exchange failed (${response.status})`);
      }
      throw new Error("OAuth token endpoint returned a non-JSON response");
    }
    if (!response.ok) {
      const code = typeof payload.error === "string" ? `: ${payload.error}` : "";
      throw new Error(`OAuth token exchange failed (${response.status})${code}`);
    }
    if (
      typeof payload.access_token !== "string" ||
      !payload.access_token ||
      typeof payload.expires_in !== "number" ||
      !Number.isFinite(payload.expires_in) ||
      payload.expires_in <= 0 ||
      typeof payload.token_type !== "string" ||
      payload.token_type.toLowerCase() !== "bearer"
    ) {
      throw new Error(
        "OAuth token endpoint did not return a valid access_token, token_type, and expires_in",
      );
    }
    return {
      value: payload.access_token,
      expiresAtMs: this.clock() + payload.expires_in * 1_000,
    };
  }
}

function formEncode(value: string): string {
  return new URLSearchParams([["value", value]]).toString().slice("value=".length);
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
