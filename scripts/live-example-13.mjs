#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installA2aCli } from "./install-a2acli.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_ROOT = join(ROOT, "skills");
const SKILL_DIR = join(SKILL_ROOT, "using-a2a-cli");
const TIMEOUT_MS = 10 * 60 * 1000;
const project = `letta-a2a-example-13-live-${process.pid}-${randomUUID().slice(0, 8)}`;
const temp = mkdtempSync(join(tmpdir(), "letta-a2a-example-13-live-"));
const providerSecretPath = join(temp, "openai-api-key");
const binaryPath = join(temp, "bin", "a2acli");
const gatewayPort = await findFreePort();
const gatewayUiPort = await findFreePort();
const oauthPort = await findFreePort();
const gatewayUrl = `http://127.0.0.1:${gatewayPort}/a2a/google-adk`;
const tokenUrl = `http://127.0.0.1:${oauthPort}/token`;
const providerKey = process.env.OPENAI_API_KEY;
const lettaVersion = /^0\.31\.12\b/;
const codexVersion = /^codex-cli 0\.153\.(?:2|[3-9]|\d{2,})\b/;
const lettaBin =
  process.env.LETTA_EXAMPLE_13_BIN || commandPath("letta", lettaVersion);
const codexBin =
  process.env.CODEX_EXAMPLE_13_BIN || commandPath("codex", codexVersion);
const sourceHashBefore = packageHash(SKILL_DIR);
const repoStateBefore = repositoryState();
const identities = [
  makeIdentity("Letta Code", "letta-code", "ORCHID"),
  makeIdentity("Codex", "codex", "SAFFRON"),
];
const secrets = () =>
  [
    providerKey,
    process.env.LETTA_API_KEY,
    process.env.CHATGPT_API_KEY,
    ...identities.flatMap((identity) => [identity.secret, identity.token]),
    ...identities.map((identity) =>
      Buffer.from(`${identity.clientId}:${identity.secret}`).toString("base64"),
    ),
  ].filter(Boolean);
const composeEnv = {
  ...process.env,
  A2A_GATEWAY_PORT: gatewayPort,
  A2A_GATEWAY_UI_PORT: gatewayUiPort,
  OAUTH_PORT: oauthPort,
  OPENAI_API_KEY_SECRET_FILE: providerSecretPath,
  ADK_MODEL_MODE: "live",
  ADK_MODEL: process.env.ADK_MODEL ?? "openai/gpt-4.1-nano",
  OAUTH_TOKEN_TTL_SECONDS: "900",
  OAUTH_LETTA_CODE_CLIENT_ID: identities[0].clientId,
  OAUTH_LETTA_CODE_CLIENT_SECRET: identities[0].secret,
  OAUTH_CODEX_CLIENT_ID: identities[1].clientId,
  OAUTH_CODEX_CLIENT_SECRET: identities[1].secret,
};

let failure;
try {
  assert(
    providerKey,
    "OPENAI_API_KEY is required for the live Example 13 proof.",
  );
  assert(lettaBin, "installed letta CLI was not found");
  assert(codexBin, "installed codex CLI was not found");
  assertVersion(lettaBin, lettaVersion, "letta");
  assertVersion(codexBin, codexVersion, "codex");
  writeFileSync(providerSecretPath, providerKey, { mode: 0o600 });
  for (const identity of identities) prepareIdentity(identity);

  compose([
    "--profile",
    "example-12-live",
    "up",
    "--build",
    "--detach",
    "--wait",
    "--wait-timeout",
    "240",
    "google-adk-agent",
    "agentgateway",
  ]);
  await installA2aCli({ destination: binaryPath });
  chmodSync(binaryPath, 0o700);

  for (const identity of identities) {
    await runHarness(identity);
    identity.token = readCachedToken(identity);
    assertToken(identity);
    assertNoSecrets(
      readFileSync(identity.transcript, "utf8"),
      `${identity.label} transcript`,
    );
  }

  assertDistinctState();
  assertCorrelation();
  assert(
    sourceHashBefore === packageHash(SKILL_DIR),
    "source skill package changed",
  );
  assert(
    repoStateBefore === repositoryState(),
    "repository was mutated by the live harnesses",
  );

  passed(
    `Letta Code live store/recall (${identities[0].codeword}, ${identities[0].contextId})`,
  );
  passed(
    `Codex live store/recall (${identities[1].codeword}, ${identities[1].contextId})`,
  );
  passed(
    "distinct 900s OAuth subjects, tokens, secret files, caches, and contexts",
  );
  passed(
    "gateway attribution, ADK correlation, Bearer stripping, and credential non-disclosure",
  );
  passed(`unchanged using-a2a-cli package SHA-256 ${sourceHashBefore}`);
  passed(
    "installed Letta Code and Codex invoked the same deterministic skill workflow",
  );
} catch (error) {
  failure = error;
} finally {
  const cleanupStatus = compose(
    ["--profile", "example-12-live", "down", "--volumes", "--remove-orphans"],
    false,
  );
  rmSync(temp, { recursive: true, force: true });
  if (cleanupStatus !== 0 && !failure)
    failure = new Error(`cleanup failed with status ${cleanupStatus}`);
}

if (failure) {
  console.error("Example 13 live harness acceptance: FAIL");
  console.error(
    redact(failure instanceof Error ? failure.stack : String(failure)),
  );
  process.exitCode = 1;
} else {
  console.log("Example 13 live harness acceptance: PASS");
}

function makeIdentity(label, prefix, codeword) {
  const slug = prefix.replaceAll("-", "_");
  return {
    label,
    prefix,
    codeword,
    clientId: `${prefix}-live-${randomUUID()}`,
    secret: `${prefix}-${randomUUID()}-${randomUUID()}`,
    secretFile: join(temp, `${slug}.secret`),
    cacheDir: join(temp, `${slug}.cache`),
    workspace: join(temp, `${slug}.workspace`),
    transcript: join(temp, `${slug}.transcript`),
  };
}

function prepareIdentity(identity) {
  writeFileSync(identity.secretFile, identity.secret, { mode: 0o600 });
  mkdirSync(identity.cacheDir, { mode: 0o700 });
  mkdirSync(identity.workspace, { mode: 0o700 });
}

async function runHarness(identity) {
  const env = harnessEnvironment(identity);
  const prompt = [
    "Use the using-a2a-cli skill explicitly and follow its deterministic workflow exactly.",
    `First send exactly: Remember the codeword ${identity.codeword} and reply STORED.`,
    "Then extract the exact contextId from that workflow result.",
    "Next run the same workflow again with that exact contextId and send exactly: What codeword did I ask you to remember?",
    "Do not use curl or invoke a2acli directly. Do not inspect credentials or unrelated repository files.",
    "Finish with one compact JSON object containing keys firstText, secondText, contextId, and workflowInvocations (which must be 2).",
  ].join(" ");

  let result;
  if (identity.prefix === "letta-code") {
    result = await runBounded(
      lettaBin,
      [
        "-p",
        prompt,
        "--ephemeral",
        "--no-mods",
        "--no-system-info-reminder",
        "--reflection-trigger",
        "off",
        "--model",
        process.env.LETTA_EXAMPLE_13_MODEL ?? "auto-chat",
        "--tools",
        "Skill,Bash",
        "--yolo",
        "--skills",
        SKILL_ROOT,
        "--skill-sources",
        "project",
        "--output-format",
        "json",
      ],
      { cwd: ROOT, env, transcript: identity.transcript },
    );
  } else {
    const agentsSkills = join(identity.workspace, ".agents", "skills");
    mkdirSync(dirname(agentsSkills), { recursive: true, mode: 0o700 });
    symlinkSync(SKILL_ROOT, agentsSkills, "dir");
    result = await runBounded(
      codexBin,
      [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--color",
        "never",
        "--sandbox",
        "danger-full-access",
        "--ignore-rules",
        ...(process.env.CODEX_EXAMPLE_13_MODEL
          ? ["--model", process.env.CODEX_EXAMPLE_13_MODEL]
          : []),
        "-C",
        identity.workspace,
        prompt,
      ],
      { cwd: identity.workspace, env, transcript: identity.transcript },
    );
  }
  assert(
    result.code === 0,
    `${identity.label} failed: ${lastSafeLines(result.output)}`,
  );
  assertNoSecrets(result.output, `${identity.label} transcript`);
  identity.reported = parseHarnessResult(result.output, identity);
  identity.contextId = identity.reported?.contextId;
  assert(identity.contextId, `${identity.label} did not report a context ID`);
  assert(
    identity.reported?.workflowInvocations === 2,
    `${identity.label} did not report two workflow invocations`,
  );
  assert(
    textMatches(identity.reported.firstText, identity.codeword, true),
    `${identity.label} first response did not store its codeword`,
  );
  assert(
    textMatches(identity.reported.secondText, identity.codeword, false),
    `${identity.label} second response did not recall its codeword`,
  );
}

function harnessEnvironment(identity) {
  const env = {};
  for (const key of [
    "HOME",
    "PATH",
    "TMPDIR",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "LETTA_API_KEY",
    "LETTA_BASE_URL",
    "LETTA_BACKEND",
    "CODEX_HOME",
    "CHATGPT_API_KEY",
  ])
    if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, {
    A2ACLI_BIN: binaryPath,
    A2A_CLI_LAUNCHER: join(ROOT, "scripts", "run-a2acli.mjs"),
    A2A_CLI_GATEWAY_URL: gatewayUrl,
    A2A_CLI_TOKEN_URL: tokenUrl,
    A2A_CLI_CLIENT_ID: identity.clientId,
    A2A_CLI_CLIENT_SECRET_FILE: identity.secretFile,
    A2A_CLI_CACHE_DIR: identity.cacheDir,
  });
  delete env.OPENAI_API_KEY;
  return env;
}

async function runBounded(command, args, { cwd, env, transcript }) {
  return await new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    let bytes = 0;
    let timedOut = false;
    const maximum = 16 * 1024 * 1024;
    const kill = (signal) => {
      try {
        if (process.platform === "win32") child.kill(signal);
        else if (child.pid) process.kill(-child.pid, signal);
      } catch {}
    };
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes <= maximum) chunks.push(chunk);
        else kill("SIGTERM");
      });
    child.on("error", (error) => chunks.push(Buffer.from(String(error))));
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 1000).unref();
    }, TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString("utf8");
      writeFileSync(transcript, output, { mode: 0o600 });
      resolvePromise({
        code: timedOut || bytes > maximum ? 1 : (code ?? 1),
        output,
      });
    });
  });
}

function parseHarnessResult(output, identity) {
  const candidates = [];
  try {
    collectObjects(JSON.parse(output), candidates);
  } catch {}
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    try {
      const parsed = JSON.parse(trimmed);
      collectObjects(parsed, candidates);
    } catch {}
    for (const match of trimmed.matchAll(/\{[^\n]*\}/g)) {
      try {
        collectObjects(JSON.parse(match[0]), candidates);
      } catch {}
    }
  }
  for (const value of candidates.reverse()) {
    if (
      value &&
      typeof value === "object" &&
      typeof value.contextId === "string" &&
      (value.workflowInvocations === 2 || value.workflowInvocations === "2") &&
      typeof value.firstText === "string" &&
      typeof value.secondText === "string"
    )
      return {
        ...value,
        workflowInvocations: Number(value.workflowInvocations),
      };
  }
  throw new Error(
    `${identity.label} final output was not parseable: ${lastSafeLines(output)}`,
  );
}

function collectObjects(value, output) {
  if (typeof value === "string") {
    const candidate = value
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    try {
      collectObjects(JSON.parse(candidate), output);
    } catch {}
    return;
  }
  if (!value || typeof value !== "object") return;
  output.push(value);
  if (Array.isArray(value))
    value.forEach((item) => collectObjects(item, output));
  else Object.values(value).forEach((item) => collectObjects(item, output));
}

function textMatches(text, codeword, first) {
  const normalized = String(text).toUpperCase();
  return first ? normalized.includes("STORED") : normalized.includes(codeword);
}

function readCachedToken(identity) {
  const files = readdirSync(identity.cacheDir).filter((name) =>
    name.endsWith(".json"),
  );
  assert(
    files.length === 1,
    `${identity.label} did not create exactly one token cache`,
  );
  const record = JSON.parse(
    readFileSync(join(identity.cacheDir, files[0]), "utf8"),
  );
  assert(
    record.clientId === identity.clientId,
    `${identity.label} cache identity mismatch`,
  );
  assert(
    record.tokenUrl === tokenUrl,
    `${identity.label} cache token URL mismatch`,
  );
  assert(
    record.scope === "a2a.discover a2a.invoke",
    `${identity.label} cache scope mismatch`,
  );
  assert(
    record.gatewayUrl === gatewayUrl,
    `${identity.label} cache gateway mismatch`,
  );
  assert(
    typeof record.accessToken === "string",
    `${identity.label} cache has no token`,
  );
  return record.accessToken;
}

function assertToken(identity) {
  const claims = JSON.parse(
    Buffer.from(identity.token.split(".")[1], "base64url").toString("utf8"),
  );
  assert(
    claims.sub === identity.clientId,
    `${identity.label} token subject mismatch`,
  );
  assert(
    claims.client_id === identity.clientId,
    `${identity.label} token client ID mismatch`,
  );
  assert(claims.role === "agent", `${identity.label} token role mismatch`);
  assert(
    claims.scope === "a2a.discover a2a.invoke",
    `${identity.label} token scope mismatch`,
  );
  assert(
    claims.exp - claims.iat === 900,
    `${identity.label} token JWT TTL mismatch`,
  );
}

function assertDistinctState() {
  for (const field of [
    "clientId",
    "secret",
    "secretFile",
    "cacheDir",
    "token",
    "contextId",
  ]) {
    assert(
      identities[0][field] !== identities[1][field],
      `harnesses shared ${field}`,
    );
  }
  for (const identity of identities) {
    const files = readdirSync(identity.cacheDir).filter((name) =>
      name.endsWith(".json"),
    );
    assert(
      files.length === 1,
      `${identity.label} did not create exactly one token cache`,
    );
    assert(
      (statSync(identity.cacheDir).mode & 0o077) === 0,
      `${identity.label} cache directory was not private`,
    );
    assert(
      (statSync(join(identity.cacheDir, files[0])).mode & 0o077) === 0,
      `${identity.label} cache file was not private`,
    );
  }
}

function assertCorrelation() {
  const captured = composeCapture([
    "--profile",
    "example-12-live",
    "logs",
    "--no-color",
    "auth-server",
    "agentgateway",
    "google-adk-agent",
  ]);
  assert(captured.status === 0, "could not inspect live service logs");
  assertNoSecrets(captured.output, "service logs");
  const records = parseJsonLogLines(captured.output);
  const observations = parseAdkObservations(captured.output);
  for (const identity of identities) {
    const gatewayTurns = records.filter(
      (record) =>
        record?.route === "default/google-adk" &&
        record?.["a2a.method"] === "SendMessage" &&
        record?.["a2a.context.id"] === identity.contextId,
    );
    assert(
      gatewayTurns.length === 2,
      `${identity.label} lacked two correlated gateway turns`,
    );
    assert(
      gatewayTurns.every((record) => record["jwt.sub"] === identity.clientId),
      `${identity.label} gateway attribution mismatch`,
    );
    const adkTurns = observations.filter(
      (record) => record.responseContextId === identity.contextId,
    );
    assert(
      adkTurns.length === 2,
      `${identity.label} lacked two correlated ADK turns`,
    );
    assert(
      adkTurns.every((record) => record.authorizationPresent === false),
      "gateway forwarded a Bearer token to ADK",
    );
  }
}

function parseJsonLogLines(output) {
  return output
    .split("\n")
    .map((line) => line.slice(Math.max(0, line.indexOf("{"))))
    .map((value) => {
      try {
        return JSON.parse(value);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

function parseAdkObservations(output) {
  return output
    .split("\n")
    .map((line) => {
      const start = line.indexOf('{"authorizationPresent"');
      if (start < 0) return undefined;
      try {
        return JSON.parse(line.slice(start));
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

function packageHash(directory) {
  const hash = createHash("sha256");
  for (const path of walk(directory).sort()) {
    const name = relative(directory, path).replaceAll("\\", "/");
    hash.update(name).update("\0");
    if (statSync(path).isSymbolicLink()) hash.update(readlinkSync(path));
    else hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function walk(directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(path));
    else output.push(path);
  }
  return output;
}

function repositoryState() {
  const status = spawnSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    {
      cwd: ROOT,
      encoding: null,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const diff = spawnSync("git", ["diff", "--binary", "HEAD"], {
    cwd: ROOT,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert(
    status.status === 0 && diff.status === 0,
    "could not snapshot repository state",
  );
  return createHash("sha256")
    .update(status.stdout)
    .update(diff.stdout)
    .digest("hex");
}

function assertNoSecrets(output, location) {
  for (const secret of secrets())
    assert(
      !String(output).includes(secret),
      `credential leaked in ${location}`,
    );
}

function assertVersion(binary, pattern, label) {
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert(
    result.status === 0 && pattern.test(result.stdout.trim()),
    `unsupported ${label} version: ${result.stdout.trim()}`,
  );
}

function commandPath(name, versionPattern) {
  const result = spawnSync("which", ["-a", name], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.status !== 0) return "";
  const candidates = [...new Set(result.stdout.split("\n").filter(Boolean))];
  return (
    candidates.find((candidate) => {
      const version = spawnSync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 10_000,
      });
      return version.status === 0 && versionPattern.test(version.stdout.trim());
    }) ??
    candidates[0] ??
    ""
  );
}

function compose(args, required = true) {
  const result = spawnSync("docker", ["compose", "-p", project, ...args], {
    cwd: ROOT,
    env: composeEnv,
    stdio: required ? "inherit" : "ignore",
    timeout: 5 * 60 * 1000,
  });
  if (required && result.status !== 0)
    throw new Error(`docker compose ${args.join(" ")} failed`);
  return result.status ?? 1;
}

function composeCapture(args) {
  const result = spawnSync("docker", ["compose", "-p", project, ...args], {
    cwd: ROOT,
    env: composeEnv,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function redact(value) {
  let output = String(value);
  for (const secret of secrets())
    output = output.split(secret).join("<redacted>");
  return output;
}

function lastSafeLines(output) {
  return redact(String(output).split("\n").slice(-20).join("\n")).slice(-4000);
}

async function findFreePort() {
  return await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) =>
        error ? reject(error) : resolvePromise(String(port)),
      );
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function passed(message) {
  console.log(`PASS: ${message}`);
}
