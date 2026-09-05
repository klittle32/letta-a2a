#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const OAUTH_SCOPE = "a2a.discover a2a.invoke";
const EXPIRY_SKEW_MS = 30_000;
const DEFAULT_CHILD_TIMEOUT_MS = 30_000;
const DEFAULT_OAUTH_TIMEOUT_MS = 10_000;
const DEFAULT_STDOUT_LIMIT = 1024 * 1024;
const DEFAULT_STDERR_LIMIT = 64 * 1024;
const DEFAULT_OAUTH_RESPONSE_LIMIT = 64 * 1024;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_ID_BYTES = 4096;
const SANITIZED_ERROR = Buffer.from("a2acli launcher failed\n");
const inProcessRefreshes = new Map();

export function parsePublicArgs(arguments_) {
  if (arguments_.length === 1 && arguments_[0] === "card") {
    return { command: "card" };
  }
  if (arguments_[0] === "send") {
    let text;
    let contextId;
    let returnImmediately = false;
    for (let index = 1; index < arguments_.length; index += 1) {
      const argument = arguments_[index];
      if (
        argument === "--text" &&
        text === undefined &&
        arguments_[index + 1] !== undefined
      ) {
        text = arguments_[++index];
      } else if (
        argument === "--context-id" &&
        contextId === undefined &&
        arguments_[index + 1] !== undefined
      ) {
        contextId = arguments_[++index];
      } else if (argument === "--return-immediately" && !returnImmediately) {
        returnImmediately = true;
      } else {
        throw new Error("invalid command");
      }
    }
    validateArgument(text, "text", MAX_TEXT_BYTES);
    if (contextId !== undefined)
      validateArgument(contextId, "context ID", MAX_ID_BYTES);
    if (!returnImmediately) throw new Error("invalid command");
    return contextId === undefined
      ? { command: "send", text }
      : { command: "send", text, contextId };
  }
  if (arguments_[0] === "get-task" || arguments_[0] === "cancel-task") {
    if (arguments_.length !== 3 || arguments_[1] !== "--task-id") {
      throw new Error("invalid command");
    }
    validateArgument(arguments_[2], "task ID", MAX_ID_BYTES);
    return { command: arguments_[0], taskId: arguments_[2] };
  }
  throw new Error("invalid command");
}

export function buildCliArgs(baseUrl, command) {
  const arguments_ = [
    "--base-url",
    baseUrl,
    "--binding",
    "jsonrpc",
    "--compact",
    command.command,
  ];
  if (command.command === "send") {
    arguments_.push("--return-immediately");
    if (command.contextId !== undefined) {
      arguments_.push("--context-id", command.contextId);
    }
    arguments_.push("--", command.text);
  } else if (
    command.command === "get-task" ||
    command.command === "cancel-task"
  ) {
    arguments_.push(command.taskId);
  }
  return arguments_;
}

export function validateConfig(environment = process.env) {
  const binary = requireRegularFile(environment, "A2ACLI_BIN", false);
  const secretFile = requireRegularFile(
    environment,
    "A2A_CLI_CLIENT_SECRET_FILE",
    true,
  );
  const gatewayUrl = validateUrl(
    required(environment, "A2A_CLI_GATEWAY_URL"),
    "gateway",
  );
  if (gatewayUrl.pathname.replace(/\/+$/, "") !== "/a2a/google-adk") {
    throw new Error("invalid launcher configuration");
  }
  const tokenUrl = validateUrl(
    required(environment, "A2A_CLI_TOKEN_URL"),
    "token endpoint",
  );
  const clientId = required(environment, "A2A_CLI_CLIENT_ID");
  validateArgument(clientId, "client ID", MAX_ID_BYTES);

  const cacheDir = environment.A2A_CLI_CACHE_DIR
    ? required(environment, "A2A_CLI_CACHE_DIR")
    : environment.XDG_RUNTIME_DIR
      ? join(environment.XDG_RUNTIME_DIR, "letta-a2a", "a2acli")
      : join(required(environment, "HOME"), ".cache", "letta-a2a", "a2acli");
  if (!isAbsolute(cacheDir)) throw new Error("invalid launcher configuration");

  return {
    binary,
    gatewayUrl: normalizeUrl(gatewayUrl),
    tokenUrl: normalizeUrl(tokenUrl),
    clientId,
    secretFile,
    cacheDir,
    scope: OAUTH_SCOPE,
  };
}

export function cacheIdentity(config) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        config.clientId,
        config.tokenUrl,
        config.scope,
        config.gatewayUrl,
      ]),
    )
    .digest("hex");
}

export async function getAccessToken(
  config,
  {
    now = Date.now(),
    oauthTimeoutMs = DEFAULT_OAUTH_TIMEOUT_MS,
    oauthResponseLimit = DEFAULT_OAUTH_RESPONSE_LIMIT,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  ensurePrivateDirectory(config.cacheDir);
  const cachePath = join(config.cacheDir, `${cacheIdentity(config)}.json`);
  const cached = readCache(cachePath, config, now);
  if (cached) return cached;
  if (inProcessRefreshes.has(cachePath))
    return await inProcessRefreshes.get(cachePath);

  const refresh = (async () => {
    const reread = readCache(cachePath, config, now);
    if (reread) return reread;
    const fresh = await mintAccessToken(config, {
      requestStartedAt: now,
      timeoutMs: oauthTimeoutMs,
      responseLimit: oauthResponseLimit,
      fetchImpl,
    });
    atomicWrite(cachePath, fresh);
    return fresh;
  })();
  inProcessRefreshes.set(cachePath, refresh);
  try {
    return await refresh;
  } finally {
    if (inProcessRefreshes.get(cachePath) === refresh) {
      inProcessRefreshes.delete(cachePath);
    }
  }
}

export function invalidateCache(config) {
  rmSync(join(config.cacheDir, `${cacheIdentity(config)}.json`), {
    force: true,
  });
}

export async function runLauncher(
  arguments_,
  environment = process.env,
  options = {},
) {
  try {
    const command = parsePublicArgs(arguments_);
    const config = validateConfig(environment);
    const authorization = await getAccessToken(config, options);
    const result = await runChild(
      config.binary,
      buildCliArgs(config.gatewayUrl, command),
      authorization.accessToken,
      options,
    );
    if (result.code !== 0) invalidateCache(config);
    return result;
  } catch {
    return failedResult();
  }
}

function validateArgument(value, label, maximumBytes) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    Buffer.byteLength(value) > maximumBytes
  ) {
    throw new Error(`invalid ${label}`);
  }
}

function required(environment, key) {
  const value = environment[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("invalid launcher configuration");
  }
  return value;
}

function requireRegularFile(environment, key, privateFile) {
  const path = required(environment, key);
  if (!isAbsolute(path)) throw new Error("invalid launcher configuration");
  assertTrustedAncestors(path);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    validatePrivateFileMetadata(fstatSync(descriptor), privateFile);
  } finally {
    closeSync(descriptor);
  }
  return path;
}

function validateUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid ${label}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`invalid ${label}`);
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopback(url.hostname))
  ) {
    throw new Error(`invalid ${label}`);
  }
  return url;
}

function isLoopback(hostname) {
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"
  );
}

function normalizeUrl(url) {
  const normalized = new URL(url);
  normalized.pathname = normalized.pathname.replace(/\/+$/, "") || "/";
  return normalized.href;
}

function ensurePrivateDirectory(path) {
  assertTrustedAncestors(path);
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  assertTrustedAncestors(path);
  const metadata = lstatSync(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error("unsafe cache directory");
  }
}

function decodeJwtClaims(accessToken) {
  if (typeof accessToken !== "string") throw new Error("malformed token");
  const parts = accessToken.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("malformed token");
  }
  return claims;
}

function validateTokenClaims(accessToken, config, now) {
  const claims = decodeJwtClaims(accessToken);
  if (
    typeof claims?.exp !== "number" ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= 0
  )
    throw new Error("malformed token");
  if (claims.sub !== config.clientId || claims.client_id !== config.clientId) {
    throw new Error("token identity mismatch");
  }
  if (claims.role !== "agent") throw new Error("token role mismatch");
  const expectedScopes = OAUTH_SCOPE.split(" ").sort();
  const actualScopes =
    typeof claims.scope === "string"
      ? claims.scope.split(/\s+/).filter(Boolean).sort()
      : [];
  if (JSON.stringify(actualScopes) !== JSON.stringify(expectedScopes)) {
    throw new Error("token scope mismatch");
  }
  const nowSeconds = now / 1000;
  if (
    (claims.nbf !== undefined &&
      (typeof claims.nbf !== "number" || claims.nbf > nowSeconds + 5)) ||
    (claims.iat !== undefined &&
      (typeof claims.iat !== "number" || claims.iat > nowSeconds + 5))
  ) {
    throw new Error("token is not yet valid");
  }
  return claims.exp * 1000;
}

function readCache(path, config, now) {
  if (!existsSync(path)) return null;
  assertTrustedAncestors(path);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let record;
  try {
    validatePrivateFileMetadata(fstatSync(descriptor), true);
    try {
      record = JSON.parse(readFileSync(descriptor, "utf8"));
    } catch {
      return null;
    }
  } finally {
    closeSync(descriptor);
  }
  if (
    record?.clientId !== config.clientId ||
    record?.tokenUrl !== config.tokenUrl ||
    record?.scope !== config.scope ||
    record?.gatewayUrl !== config.gatewayUrl ||
    typeof record?.accessToken !== "string" ||
    !Number.isFinite(record?.expiresAtMs)
  ) {
    return null;
  }
  if (
    record.expiresAtMs - now <= EXPIRY_SKEW_MS ||
    validateTokenClaims(record.accessToken, config, now) - now <= EXPIRY_SKEW_MS
  ) {
    return null;
  }
  return record;
}

function atomicWrite(path, value) {
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const descriptor = openSync(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(descriptor, JSON.stringify(value));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryPath, path);
  const directoryDescriptor = openSync(dirname(path), constants.O_RDONLY);
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

async function mintAccessToken(
  config,
  { requestStartedAt, timeoutMs, responseLimit, fetchImpl },
) {
  const secret = readPrivateFile(config.secretFile).replace(/[\r\n]+$/, "");
  if (!secret) throw new Error("invalid secret");
  if (typeof fetchImpl !== "function")
    throw new Error("OAuth fetch unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(config.tokenUrl, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${formEncode(config.clientId)}:${formEncode(secret)}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: config.scope,
      }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("OAuth failed");
    const body = JSON.parse(
      (await readBoundedBody(response, responseLimit)).toString("utf8"),
    );
    if (
      typeof body.access_token !== "string" ||
      typeof body.expires_in !== "number" ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0 ||
      typeof body.token_type !== "string" ||
      body.token_type.toLowerCase() !== "bearer"
    ) {
      throw new Error("malformed token");
    }
    const expiresAtMs = Math.min(
      requestStartedAt + body.expires_in * 1000,
      validateTokenClaims(body.access_token, config, requestStartedAt),
    );
    if (expiresAtMs - requestStartedAt <= EXPIRY_SKEW_MS) {
      throw new Error("stale token");
    }
    return {
      clientId: config.clientId,
      tokenUrl: config.tokenUrl,
      scope: config.scope,
      gatewayUrl: config.gatewayUrl,
      accessToken: body.access_token,
      expiresAtMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBody(response, limit) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new Error("OAuth response too large");
  }
  if (!response.body) throw new Error("OAuth response has no body");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("OAuth response too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function runChild(
  binary,
  arguments_,
  accessToken,
  {
    childTimeoutMs = DEFAULT_CHILD_TIMEOUT_MS,
    stdoutLimit = DEFAULT_STDOUT_LIMIT,
    stderrLimit = DEFAULT_STDERR_LIMIT,
  } = {},
) {
  return new Promise((resolvePromise) => {
    const child = spawn(binary, arguments_, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: childEnvironment(accessToken),
    });
    const stdout = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failed = false;
    let finished = false;
    let forceKillTimer;

    const terminate = () => {
      if (forceKillTimer) return;
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {}
      forceKillTimer = setTimeout(() => {
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 100);
      forceKillTimer.unref();
    };

    child.stdout.on("data", (chunk) => {
      if (failed) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > stdoutLimit) {
        failed = true;
        stdout.length = 0;
        terminate();
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      if (failed) return;
      stderrBytes += chunk.length;
      if (stderrBytes > stderrLimit) {
        failed = true;
        stdout.length = 0;
        terminate();
      }
    });
    child.on("error", () => {
      failed = true;
      stdout.length = 0;
    });

    const deadline = setTimeout(() => {
      failed = true;
      stdout.length = 0;
      terminate();
    }, childTimeoutMs);

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      const output = Buffer.concat(stdout);
      if (!failed && code === 0) {
        try {
          JSON.parse(output.toString("utf8"));
          resolvePromise({ code: 0, stdout: output, stderr: Buffer.alloc(0) });
          return;
        } catch {}
      }
      resolvePromise(failedResult());
    });
  });
}

function childEnvironment(accessToken) {
  const environment = { A2A_BEARER_TOKEN: accessToken };
  for (const key of [
    "HOME",
    "PATH",
    "TMPDIR",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

function readPrivateFile(path) {
  assertTrustedAncestors(path);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    validatePrivateFileMetadata(fstatSync(descriptor), true);
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function validatePrivateFileMetadata(metadata, privateFile) {
  if (
    !metadata.isFile() ||
    (privateFile && (metadata.mode & 0o077) !== 0) ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error("invalid launcher configuration");
  }
}

function assertTrustedAncestors(path) {
  const directory = dirname(resolve(path));
  const root = parse(directory).root;
  let current = root;
  for (const component of relative(root, directory)
    .split(/[\\/]+/)
    .filter(Boolean)) {
    current = join(current, component);
    if (!existsSync(current)) break;
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink()) {
      if (metadata.uid === 0) continue;
      throw new Error("unsafe path ancestor");
    }
    if (!metadata.isDirectory()) throw new Error("unsafe path ancestor");
  }
}

function formEncode(value) {
  return new URLSearchParams([["value", value]])
    .toString()
    .slice("value=".length);
}

function failedResult() {
  return {
    code: 1,
    stdout: Buffer.alloc(0),
    stderr: SANITIZED_ERROR,
  };
}

async function main() {
  const result = await runLauncher(process.argv.slice(2));
  if (result.code === 0) process.stdout.write(result.stdout);
  else process.stderr.write(result.stderr);
  process.exitCode = result.code;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
