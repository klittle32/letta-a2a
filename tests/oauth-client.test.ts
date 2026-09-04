import { describe, expect, test } from "bun:test";

import { ClientCredentialsTokenProvider } from "../services/bridge/src/oauth-client.js";

describe("OAuth client credentials token provider", () => {
  test("exchanges credentials, caches the token, and refreshes near expiry", async () => {
    const requests: Request[] = [];
    let now = 1_000_000;
    let sequence = 0;
    const provider = new ClientCredentialsTokenProvider(
      {
        tokenUrl: "http://auth-server:9000/token",
        clientId: "bridge-client",
        clientSecret: "bridge-secret",
        scope: "a2a.invoke",
        refreshSkewMs: 5_000,
      },
      async (input, init) => {
        requests.push(new Request(input, init));
        sequence += 1;
        return Response.json({
          access_token: `access-${sequence}`,
          token_type: "Bearer",
          expires_in: 60,
          scope: "a2a.invoke",
        });
      },
      () => now,
    );

    expect(await provider.getAccessToken()).toBe("access-1");
    expect(await provider.getAccessToken()).toBe("access-1");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get("authorization")).toBe(
      `Basic ${btoa("bridge-client:bridge-secret")}`,
    );
    expect(await requests[0]?.text()).toBe(
      "grant_type=client_credentials&scope=a2a.invoke",
    );

    now += 56_000;
    expect(await provider.getAccessToken()).toBe("access-2");
    expect(requests).toHaveLength(2);
  });

  test("deduplicates concurrent exchanges and rejects malformed token responses", async () => {
    let resolveExchange!: (response: Response) => void;
    let exchangeCount = 0;
    const exchange = new Promise<Response>((resolve) => {
      resolveExchange = resolve;
    });
    const provider = new ClientCredentialsTokenProvider(
      {
        tokenUrl: "http://auth-server:9000/token",
        clientId: "bridge-client",
        clientSecret: "bridge-secret",
        scope: "a2a.invoke",
      },
      async () => {
        exchangeCount += 1;
        return exchange;
      },
    );

    const first = provider.getAccessToken();
    const second = provider.getAccessToken();
    resolveExchange(
      Response.json({
        access_token: "shared-token",
        token_type: "Bearer",
        expires_in: 60,
      }),
    );

    expect(await Promise.all([first, second])).toEqual([
      "shared-token",
      "shared-token",
    ]);
    expect(exchangeCount).toBe(1);

    const invalid = new ClientCredentialsTokenProvider(
      {
        tokenUrl: "http://auth-server:9000/token",
        clientId: "bridge-client",
        clientSecret: "bridge-secret",
        scope: "a2a.invoke",
      },
      async () => Response.json({ token_type: "Bearer", expires_in: 60 }),
    );
    await expect(invalid.getAccessToken()).rejects.toThrow(
      "valid access_token",
    );
  });

  test("shares the exchange without sharing caller cancellation", async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();
    let resolveExchange!: (response: Response) => void;
    const exchange = new Promise<Response>((resolve) => {
      resolveExchange = resolve;
    });
    const provider = new ClientCredentialsTokenProvider(
      {
        tokenUrl: "http://auth-server:9000/token",
        clientId: "bridge-client",
        clientSecret: "bridge-secret",
        scope: "a2a.invoke",
      },
      async (_input, init) => {
        if (!init?.signal) return exchange;
        return Promise.race([
          exchange,
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
        ]);
      },
    );

    const first = provider.getAccessToken(firstController.signal);
    const second = provider.getAccessToken(secondController.signal);
    firstController.abort(new Error("first caller canceled"));
    resolveExchange(
      Response.json({
        access_token: "shared-token",
        token_type: "Bearer",
        expires_in: 60,
      }),
    );

    await expect(first).rejects.toThrow("first caller canceled");
    await expect(second).resolves.toBe("shared-token");
  });

  test("does not expose the client secret in exchange errors", async () => {
    const provider = new ClientCredentialsTokenProvider(
      {
        tokenUrl: "http://auth-server:9000/token",
        clientId: "bridge-client",
        clientSecret: "do-not-print-this-secret",
        scope: "a2a.invoke",
      },
      async () =>
        Response.json(
          { error: "invalid_client", error_description: "client rejected" },
          { status: 401 },
        ),
    );

    try {
      await provider.getAccessToken();
      throw new Error("expected token exchange to fail");
    } catch (error) {
      const message = String(error);
      expect(message).toContain("invalid_client");
      expect(message).not.toContain("do-not-print-this-secret");
    }
  });
});
