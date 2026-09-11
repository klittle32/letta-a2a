import { describe, test, expect } from "bun:test";
import express from "express";
import { generateKeyPair, SignJWT } from "jose";
import { ServerCallContext } from "@a2a-js/sdk/server";
import { createServiceAuth } from "../services/bridge/src/auth.js";

const keys = await generateKeyPair("RS256");
const issuer = "https://issuer.test";
const audience = "letta-a2a-gateway";
async function token(
  claims: Record<string, unknown> = {},
  overrides: {
    issuer?: string;
    audience?: string;
    expiration?: number;
    nbf?: number;
  } = {},
) {
  return new SignJWT({
    scope: "a2a.discover a2a.invoke",
    role: "operator",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject("same-subject")
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience)
    .setExpirationTime(
      overrides.expiration ?? Math.floor(Date.now() / 1000) + 60,
    )
    .setNotBefore(overrides.nbf ?? 0)
    .sign(keys.privateKey);
}
async function fixture() {
  const auth = createServiceAuth({
    issuer,
    audience,
    jwksUrl: "https://unused.test/jwks",
    maximumHops: 2,
    keyResolver: async () => keys.publicKey,
  });
  const app = express();
  app.use(express.json(), ...auth.transport.middleware);
  app.post("/", async (req, res) => {
    try {
      const context = new ServerCallContext({
        user: await auth.transport.userBuilder(req),
      });
      const caller = await auth.authorization.projectCaller(context);
      if (!caller) return void res.sendStatus(401);
      const operation = req.body.operation ?? "sendMessage";
      const allowed = await auth.authorization.authorize({
        caller,
        operation,
        context,
        params: req.body.params,
      });
      res.status(allowed ? 200 : 403).json(caller);
    } catch {
      res.sendStatus(403);
    }
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  return {
    auth,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
    request: (
      jwt?: string,
      params: unknown = message(),
      headers: Record<string, string> = {},
      operation = "sendMessage",
    ) =>
      fetch(`http://127.0.0.1:${address.port}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
          ...headers,
        },
        body: JSON.stringify({ method: "SendMessage", params, operation }),
      }),
  };
}
function message(text = "hello", metadata?: unknown, configuration?: unknown) {
  return { message: { parts: [{ text }] }, metadata, configuration };
}
test("direct JWT claim requirements match the gateway", async () => {
  const f = await fixture();
  try {
    const claims = {
      sub: "same-subject",
      iss: issuer,
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 60,
      nbf: 0,
      scope: "a2a.discover",
      role: "operator",
    };
    for (const missing of ["nbf", "scope", "role"] as const) {
      const incomplete: Record<string, unknown> = { ...claims };
      delete incomplete[missing];
      const jwt = await new SignJWT(incomplete)
        .setProtectedHeader({ alg: "RS256" })
        .sign(keys.privateKey);
      expect((await f.request(jwt, {}, {}, "discover")).status).toBe(401);
    }
  } finally {
    f.close();
  }
});

describe("verified request-local JWT policy", () => {
  test("denies direct bypass, unsigned/spoofed users and invalid JWT claims", async () => {
    const f = await fixture();
    try {
      expect(
        await f.auth.authorization.projectCaller(
          new ServerCallContext({
            user: { isAuthenticated: true, userName: "same-subject" },
          }),
        ),
      ).toBeUndefined();
      const foreignKeys = await generateKeyPair("RS256");
      const wrongSignature = await new SignJWT({
        scope: "a2a.invoke",
        role: "operator",
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject("same-subject")
        .setExpirationTime("1m")
        .sign(foreignKeys.privateKey);
      const missingExpiry = await new SignJWT({
        scope: "a2a.invoke",
        role: "operator",
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject("same-subject")
        .sign(keys.privateKey);
      for (const jwt of [
        undefined,
        "forged",
        wrongSignature,
        missingExpiry,
        await token({}, { issuer: "https://evil.test" }),
        await token({}, { audience: "other" }),
        await token({}, { expiration: 1 }),
        await token({}, { nbf: Math.floor(Date.now() / 1000) + 600 }),
      ]) {
        expect(
          (
            await f.request(jwt, message(), {
              "x-user": "operator",
              "x-role": "agent",
            })
          ).status,
        ).toBe(401);
      }
    } finally {
      f.close();
    }
  });
  test("same-subject simultaneous scopes never bleed; discover and invoke are separate", async () => {
    const f = await fixture();
    try {
      const invoke = await token({ scope: "a2a.invoke" });
      const discover = await token({ scope: "a2a.discover" });
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          f.request(i % 2 ? invoke : discover),
        ),
      );
      expect(responses.map((r) => r.status)).toEqual(
        Array.from({ length: 20 }, (_, i) => (i % 2 ? 200 : 403)),
      );
      expect((await f.request(invoke, {}, {}, "discover")).status).toBe(403);
      expect((await f.request(discover, {}, {}, "discover")).status).toBe(200);
      expect((await f.request(await token({ role: "reader" }))).status).toBe(
        403,
      );
      expect(
        (await f.request(await token({ role: "reader", roles: ["operator"] })))
          .status,
      ).toBe(403);
    } finally {
      f.close();
    }
  });
  test("verified delegate legacy hops, header parity, canonical bounds, explicit async policy", async () => {
    const f = await fixture();
    try {
      const operator = await token();
      const agent = await token({ role: "agent", tenant: "verified-tenant" });
      expect(
        (
          await f.request(
            operator,
            message("hello", { lettaA2aLab: { hop: 0 } }),
          )
        ).status,
      ).toBe(200);
      expect(
        (await f.request(operator, message(), { "x-letta-a2a-hop": "1" }))
          .status,
      ).toBe(403);
      expect((await f.request(agent)).status).toBe(403);
      for (const hop of ["0", "01", "-1", "1.0", "3", "9007199254740992"])
        expect(
          (await f.request(agent, message(), { "x-letta-a2a-hop": hop }))
            .status,
        ).toBe(403);
      for (const hop of [0, "1", -1, 3])
        expect(
          (await f.request(agent, message("hello", { lettaA2aLab: { hop } })))
            .status,
        ).toBe(403);
      expect(
        (
          await f.request(
            agent,
            message("hello", { lettaA2aLab: { hop: 1 } }),
            { "x-letta-a2a-hop": "2" },
          )
        ).status,
      ).toBe(403);
      const accepted = await f.request(
        agent,
        message(
          "a2a_invoke",
          { lettaA2aLab: { hop: 1 } },
          { returnImmediately: true },
        ),
      );
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toMatchObject({
        tenant: "verified-tenant",
        delegation: { hop: 1, allowDelegation: true },
      });
      const limit = await f.request(
        agent,
        message("a2a_invoke", undefined, { returnImmediately: true }),
        { "x-letta-a2a-hop": "2" },
      );
      expect(await limit.json()).toMatchObject({
        delegation: { hop: 2, allowDelegation: false },
      });
      expect((await f.request(operator, message("a2a_invoke"))).status).toBe(
        403,
      );
      expect((await f.request(agent, {}, {}, "getTask")).status).toBe(200);
    } finally {
      f.close();
    }
  });
});
