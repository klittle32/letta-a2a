import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCliArgs,
  cacheIdentity,
  getAccessToken,
  parsePublicArgs,
  runLauncher,
  validateConfig,
} from "../scripts/run-a2acli.mjs";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function temp() {
  const root = mkdtempSync(join(tmpdir(), "run-a2acli-"));
  roots.push(root);
  return root;
}
function jwt(
  exp: number,
  marker = "token",
  claims: Record<string, unknown> = {
    sub: "client",
    client_id: "client",
    role: "agent",
    scope: "a2a.discover a2a.invoke",
  },
) {
  const enc = (v: object) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc({ exp, ...claims })}.${marker}`;
}
async function tokenServer(
  handler: (body: string, auth: string | undefined) => object,
) {
  let count = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      count++;
      const result = handler(body, req.headers.authorization);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("listen failed");
  return { url: `http://127.0.0.1:${addr.port}/token`, count: () => count };
}
function config(root: string, tokenUrl: string, clientId = "client") {
  const secret = join(root, "secret");
  writeFileSync(secret, "top-secret\n", { mode: 0o600 });
  const bin = join(root, "a2acli");
  writeFileSync(bin, "", { mode: 0o700 });
  return {
    A2ACLI_BIN: bin,
    A2A_CLI_GATEWAY_URL: "https://gateway.example/a2a/google-adk",
    A2A_CLI_TOKEN_URL: tokenUrl,
    A2A_CLI_CLIENT_ID: clientId,
    A2A_CLI_CLIENT_SECRET_FILE: secret,
    A2A_CLI_CACHE_DIR: join(root, "cache"),
  };
}
function executable(path: string, source: string) {
  writeFileSync(path, `#!/usr/bin/env node\n${source}`, { mode: 0o700 });
  chmodSync(path, 0o700);
}

describe("public grammar", () => {
  test("accepts only structured commands", () => {
    expect(parsePublicArgs(["card"])).toEqual({ command: "card" });
    expect(
      parsePublicArgs([
        "send",
        "--text",
        "hello; $HOME",
        "--context-id",
        "opaque",
        "--return-immediately",
      ]),
    ).toEqual({ command: "send", text: "hello; $HOME", contextId: "opaque" });
    expect(parsePublicArgs(["get-task", "--task-id", "t"])).toEqual({
      command: "get-task",
      taskId: "t",
    });
    expect(parsePublicArgs(["cancel-task", "--task-id", "t"])).toEqual({
      command: "cancel-task",
      taskId: "t",
    });
    for (const bad of [
      ["card", "--url", "x"],
      ["send", "--text", "x"],
      ["send", "--text", "x", "--return-immediately", "--header", "x"],
      ["get-task", "t"],
      ["stream"],
      ["--base-url", "x", "card"],
    ])
      expect(() => parsePublicArgs(bad)).toThrow();
  });
  test("constructs fixed upstream argv", () => {
    const base = "https://g.example/a2a/google-adk";
    expect(buildCliArgs(base, { command: "card" })).toEqual([
      "--base-url",
      base,
      "--binding",
      "jsonrpc",
      "--compact",
      "card",
    ]);
    expect(
      buildCliArgs(base, { command: "send", text: "hello", contextId: "c" }),
    ).toEqual([
      "--base-url",
      base,
      "--binding",
      "jsonrpc",
      "--compact",
      "send",
      "--return-immediately",
      "--context-id",
      "c",
      "--",
      "hello",
    ]);
    expect(buildCliArgs(base, { command: "get-task", taskId: "t" })).toEqual([
      "--base-url",
      base,
      "--binding",
      "jsonrpc",
      "--compact",
      "get-task",
      "t",
    ]);
  });
  test("requires trusted absolute paths and exact normalized gateway route", () => {
    const root = temp();
    const good = config(root, "https://issuer.example/token");
    executable(good.A2ACLI_BIN, "");
    expect(validateConfig(good).gatewayUrl).toBe(good.A2A_CLI_GATEWAY_URL);
    for (const url of [
      "https://g.example/other",
      "https://g.example/a2a/google-adk?x=1",
      "https://u:p@g.example/a2a/google-adk",
      "https://g.example/a2a/google-adk#x",
    ])
      expect(() =>
        validateConfig({ ...good, A2A_CLI_GATEWAY_URL: url }),
      ).toThrow();
    expect(() => validateConfig({ ...good, A2ACLI_BIN: "a2acli" })).toThrow();
  });
});

describe("OAuth cache", () => {
  test("caches by complete identity with private permissions", async () => {
    const root = temp();
    const now = Date.now();
    const srv = await tokenServer((_body, authorization) => {
      const clientId = Buffer.from(
        (authorization ?? "").slice("Basic ".length),
        "base64",
      )
        .toString()
        .split(":", 1)[0];
      return {
        access_token: jwt(Math.floor(now / 1000) + 300, "token", {
          sub: clientId,
          client_id: clientId,
          role: "agent",
          scope: "a2a.discover a2a.invoke",
        }),
        expires_in: 300,
        token_type: "Bearer",
      };
    });
    const a = validateConfig(config(root, srv.url, "alpha"));
    const b = validateConfig(config(root, srv.url, "beta"));
    expect(cacheIdentity(a)).not.toBe(cacheIdentity(b));
    const first = await getAccessToken(a, { now });
    const second = await getAccessToken(a, { now: now + 1000 });
    await getAccessToken(b, { now });
    expect(first.accessToken).toBe(second.accessToken);
    expect(srv.count()).toBe(2);
    expect(lstatSync(a.cacheDir).mode & 0o777).toBe(0o700);
    for (const name of readdirSync(a.cacheDir).filter((n) =>
      n.endsWith(".json"),
    ))
      expect(lstatSync(join(a.cacheDir, name)).mode & 0o777).toBe(0o600);
  });
  test("uses earlier OAuth/JWT expiry, rejects malformed values, and remints stale cache", async () => {
    const root = temp();
    const now = Date.now();
    let n = 0;
    const srv = await tokenServer(() => ({
      access_token: jwt(Math.floor(now / 1000) + (n++ ? 300 : 35), String(n)),
      expires_in: 300,
      token_type: "Bearer",
    }));
    const cfg = validateConfig(config(root, srv.url));
    await getAccessToken(cfg, { now });
    await getAccessToken(cfg, { now: now + 6000 });
    expect(srv.count()).toBe(2);
    const bad = await tokenServer(() => ({
      access_token: "not.jwt",
      expires_in: 300,
      token_type: "Bearer",
    }));
    await expect(
      getAccessToken(validateConfig(config(temp(), bad.url)), { now }),
    ).rejects.toThrow();
  });
  test("deduplicates concurrent refresh and bounds OAuth responses", async () => {
    const root = temp();
    const now = Date.now();
    const srv = await tokenServer(() => ({
      access_token: jwt(Math.floor(now / 1000) + 300),
      expires_in: 300,
      token_type: "Bearer",
    }));
    const cfg = validateConfig(config(root, srv.url));
    const [first, second] = await Promise.all([
      getAccessToken(cfg, { now }),
      getAccessToken(cfg, { now }),
    ]);
    expect(first.accessToken).toBe(second.accessToken);
    expect(srv.count()).toBe(1);

    const oversized = await tokenServer(() => ({ padding: "x".repeat(1024) }));
    await expect(
      getAccessToken(validateConfig(config(temp(), oversized.url)), {
        now,
        oauthResponseLimit: 32,
      }),
    ).rejects.toThrow();
  });
  test("does not let an abandoned lock file disable token refresh", async () => {
    const root = temp();
    const now = Date.now();
    const srv = await tokenServer(() => ({
      access_token: jwt(Math.floor(now / 1000) + 300),
      expires_in: 300,
      token_type: "Bearer",
    }));
    const cfg = validateConfig(config(root, srv.url));
    Bun.spawnSync(["mkdir", "-m", "700", cfg.cacheDir]);
    writeFileSync(
      join(cfg.cacheDir, `${cacheIdentity(cfg)}.json.lock`),
      "orphan",
      {
        mode: 0o600,
      },
    );

    const token = await getAccessToken(cfg, { now, oauthTimeoutMs: 25 });
    expect(token.accessToken).toContain(".");
    expect(srv.count()).toBe(1);
  });
  test("validates token identity and form-encodes Basic credentials", async () => {
    const root = temp();
    const now = Date.now();
    let authorization = "";
    const srv = await tokenServer((_body, auth) => {
      authorization = auth ?? "";
      return {
        access_token: jwt(Math.floor(now / 1000) + 300, "signature", {
          sub: "client:name",
          client_id: "client:name",
          role: "agent",
          scope: "a2a.discover a2a.invoke",
        }),
        expires_in: 300,
        token_type: "Bearer",
      };
    });
    const environment = config(root, srv.url, "client:name");
    writeFileSync(environment.A2A_CLI_CLIENT_SECRET_FILE, "s e%", {
      mode: 0o600,
    });
    await getAccessToken(validateConfig(environment), { now });
    expect(
      Buffer.from(authorization.slice("Basic ".length), "base64").toString(),
    ).toBe("client%3Aname:s+e%25");

    const mismatched = await tokenServer(() => ({
      access_token: jwt(Math.floor(now / 1000) + 300, "signature", {
        sub: "another-client",
        client_id: "another-client",
        role: "agent",
        scope: "a2a.discover a2a.invoke",
      }),
      expires_in: 300,
      token_type: "Bearer",
    }));
    await expect(
      getAccessToken(
        validateConfig(config(temp(), mismatched.url, "expected")),
        {
          now,
        },
      ),
    ).rejects.toThrow("token identity");
  });
  test("refuses symlink cache directory", async () => {
    const root = temp();
    const srv = await tokenServer(() => ({
      access_token: jwt(Date.now() / 1000 + 300),
      expires_in: 300,
      token_type: "Bearer",
    }));
    const env = config(root, srv.url);
    const target = join(root, "target");
    Bun.spawnSync(["mkdir", target]);
    Bun.spawnSync(["ln", "-s", target, env.A2A_CLI_CACHE_DIR]);
    await expect(getAccessToken(validateConfig(env))).rejects.toThrow();
  });
});

describe("child containment", () => {
  test("passes token only through child env and preserves valid stdout bytes", async () => {
    const root = temp();
    const token = jwt(
      Math.floor(Date.now() / 1000) + 300,
      "SECRET_TOKEN_MARKER",
    );
    const srv = await tokenServer(() => ({
      access_token: token,
      expires_in: 300,
      token_type: "Bearer",
    }));
    const env = {
      ...config(root, srv.url),
      OTHER_LOCAL_SECRET: "do-not-inherit",
    };
    executable(
      env.A2ACLI_BIN,
      `const fs=require('fs'); fs.writeFileSync(${JSON.stringify(join(root, "seen.json"))},JSON.stringify({argv:process.argv.slice(2),token:process.env.A2A_BEARER_TOKEN,other:process.env.OTHER_LOCAL_SECRET,secretFile:process.env.A2A_CLI_CLIENT_SECRET_FILE})); process.stdout.write('{ "ok" : true }\\n')`,
    );
    const out = await runLauncher(["card"], env);
    expect(out.stdout.toString()).toBe('{ "ok" : true }\n');
    const seen = JSON.parse(readFileSync(join(root, "seen.json"), "utf8"));
    expect(seen.token).toBe(token);
    expect(seen.other).toBeUndefined();
    expect(seen.secretFile).toBeUndefined();
    expect(JSON.stringify(seen.argv)).not.toContain(token);
    expect(out.stdout.toString() + out.stderr.toString()).not.toContain(token);
  });
  test("sanitizes nonzero, malformed, timeout and oversized output and invalidates cache", async () => {
    for (const source of [
      "process.stderr.write(process.env.A2A_BEARER_TOKEN);process.exit(2)",
      "process.stdout.write('nope')",
      "process.stdout.write('x'.repeat(1048577))",
      "setTimeout(()=>{},60000)",
    ]) {
      const root = temp();
      const srv = await tokenServer(() => ({
        access_token: jwt(Math.floor(Date.now() / 1000) + 300, "LEAK"),
        expires_in: 300,
        token_type: "Bearer",
      }));
      const env = config(root, srv.url);
      executable(env.A2ACLI_BIN, source);
      const result = await runLauncher(["card"], env, {
        childTimeoutMs: source.includes("setTimeout") ? 30 : 30000,
      });
      expect(result.code).not.toBe(0);
      expect(result.stdout.length).toBe(0);
      expect(result.stderr.toString()).toBe("a2acli launcher failed\n");
      expect(result.stderr.toString()).not.toContain("LEAK");
      expect(
        readdirSync(env.A2A_CLI_CACHE_DIR).filter((name) =>
          name.endsWith(".json"),
        ),
      ).toHaveLength(0);
    }
  });
  test("never retries send after child failure", async () => {
    const root = temp();
    const srv = await tokenServer(() => ({
      access_token: jwt(Math.floor(Date.now() / 1000) + 300),
      expires_in: 300,
      token_type: "Bearer",
    }));
    const env = config(root, srv.url);
    executable(
      env.A2ACLI_BIN,
      `require('fs').appendFileSync(${JSON.stringify(join(root, "calls"))},'x');process.exit(1)`,
    );
    await runLauncher(["send", "--text", "hello", "--return-immediately"], env);
    expect(readFileSync(join(root, "calls"), "utf8")).toBe("x");
  });
});
