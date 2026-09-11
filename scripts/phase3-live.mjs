// Manual, billable proof: OPENAI_API_KEY=... node scripts/phase3-live.mjs --run
// Build the bridge first. Node 24 / SDK 0.8.3 / Code 0.31.7; no Bun runtime.
// Only a fresh temporary local backend is permitted. This is NOT a JWT/HTTP proof.
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const self = fileURLToPath(import.meta.url);
const model = "openai/gpt-4.1-nano";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bounded(work, ms, label) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function supervise() {
  assert.equal(
    process.argv[2],
    "--run",
    "Opt in with --run (uses OpenAI credit)",
  );
  assert.equal(process.versions.node.split(".")[0], "24", "Use Node 24");
  assert(process.env.OPENAI_API_KEY, "OPENAI_API_KEY is required");
  const root = await realpath(await mkdtemp(join(tmpdir(), "phase3-live-")));
  const token = randomUUID();
  let child;
  let forced = false;
  const kill = (signal) => {
    if (child?.pid) {
      try {
        process.kill(-child.pid, signal);
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
      }
    }
  };
  const interrupt = () => {
    forced = true;
    kill("SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await mkdir(join(root, "home"));
    await mkdir(join(root, "cwd"));
    await writeFile(join(root, "permit"), token, { mode: 0o600 });
    // An allowlist, never {...process.env}: no parent agent IDs, endpoint,
    // credentials, NODE_OPTIONS, mods, memory paths, or backend state inherited.
    child = spawn(process.execPath, [self, "--isolated-worker"], {
      detached: true,
      cwd: join(root, "cwd"),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
        HOME: join(root, "home"),
        TMPDIR: root,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        LETTA_LOCAL_BACKEND_DIR: join(root, "backend"),
        LETTA_LOCAL_BACKEND_EXPERIMENTAL: "1",
        PHASE3_ROOT: root,
        PHASE3_PERMIT: token,
      },
    });
    // Suppress arbitrary SDK/provider logs (may contain private payloads).
    // Only our prefixed JSON report crosses the supervisor boundary.
    let output = "";
    child.stdout.on("data", (data) => {
      output = (output + data).slice(-131072);
    });
    child.stderr.on("data", () => {});
    const code = await bounded(
      new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      }),
      210_000,
      "whole proof",
    );
    for (const line of output.split("\n")) {
      if (line.startsWith("PHASE3_REPORT ")) console.log(line);
    }
    assert.equal(
      code,
      0,
      "Isolated proof failed (raw SDK logs intentionally suppressed)",
    );
    assert(!forced, "Proof interrupted");
  } finally {
    kill("SIGTERM");
    await sleep(1000);
    kill("SIGKILL");
    await sleep(200);
    let gone = true;
    if (child?.pid) {
      try {
        process.kill(-child.pid, 0);
        gone = false;
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
      }
    }
    await rm(root, { recursive: true, force: true });
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    console.log(
      `PHASE3_REPORT ${JSON.stringify({ cleanup: gone, temporaryStateRemoved: true })}`,
    );
    assert(gone, "Owned process group remains");
  }
}

async function worker() {
  let stage = "isolation";
  let bridge;
  try {
    const root = process.env.PHASE3_ROOT;
    assert(root && root.includes("/phase3-live-"));
    assert.equal(await realpath(root), root);
    assert.equal(process.env.HOME, join(root, "home"));
    assert.equal(await realpath(process.cwd()), join(root, "cwd"));
    assert.equal(process.env.LETTA_LOCAL_BACKEND_DIR, join(root, "backend"));
    assert.equal(
      await readFile(join(root, "permit"), "utf8"),
      process.env.PHASE3_PERMIT,
    );
    for (const key of [
      "LETTA_AGENT_ID",
      "LETTA_PARENT_AGENT_ID",
      "LETTA_CONVERSATION_ID",
      "LETTA_BASE_URL",
      "LETTA_API_KEY",
      "LETTA_APP_SERVER_TOKEN",
      "NODE_OPTIONS",
      "NODE_PATH",
    ])
      assert(!process.env[key]);
    assert.equal(process.versions.node.split(".")[0], "24");
    stage = "compiled imports";
    const packageRoot = new URL(
      "../packages/letta-a2a-bridge/",
      import.meta.url,
    );
    const scopedRequire = createRequire(new URL("package.json", packageRoot));
    for (const [name, version] of [
      ["letta-agent-sdk", "0.8.3"],
      ["letta-code", "0.31.7"],
    ]) {
      const manifest = JSON.parse(
        await readFile(
          new URL(`node_modules/@letta-ai/${name}/package.json`, packageRoot),
          "utf8",
        ),
      );
      assert.equal(
        manifest.version,
        version,
        "Revalidate this fixture before changing SDK/runtime versions",
      );
    }
    // Follow public ESM exports, with dependency resolution anchored to the bridge,
    // never the repository root (which may have a different Agent SDK version).
    async function publicEntry(root, subpath = ".") {
      const manifest = JSON.parse(
        await readFile(new URL("package.json", root), "utf8"),
      );
      return import(new URL(manifest.exports[subpath].import, root));
    }
    const { createBridge, createAgentToolGuard } =
      await publicEntry(packageRoot);
    const { LettaAgentClient } = await import(
      pathToFileURL(scopedRequire.resolve("@letta-ai/letta-agent-sdk"))
    );
    const a2aRoot = new URL("node_modules/@a2a-js/sdk/", packageRoot);
    const { SendMessageRequest, TaskState } = await publicEntry(a2aRoot);
    const { ServerCallContext } = await publicEntry(a2aRoot, "./server");
    assert.equal(typeof createAgentToolGuard, "function");
    const client = new LettaAgentClient({
      backend: "local",
      appServer: {
        harnessBackend: "local",
        pinGlobalAgent: false,
        startupTimeoutMs: 20_000,
        requestTimeoutMs: 50_000,
      },
    });
    stage = "fresh agent";
    const agentId = await bounded(
      client.createAgent({
        model,
        name: "phase3-disposable-proof",
        memfs: false,
        memory: [],
        baseTools: [],
        permissionMode: "strict",
        cwd: process.cwd(),
        systemPrompt:
          "You are a tiny protocol test assistant. Follow explicit tool instructions exactly once, never retry denied tools. Keep answers under 12 words. Remember conversation text only.",
      }),
      35_000,
      stage,
    );
    assert(agentId.startsWith("agent-local-"));
    let guards = 0,
      inventories = 0,
      approved = 0,
      denied = 0,
      forbiddenExecutions = 0;
    const observations = [];
    const guard = createAgentToolGuard(
      {
        agents: {
          retrieve: async (id) => {
            assert.equal(id, agentId);
            const inventory = await client.agents.retrieve(id);
            inventories++;
            assert.deepEqual(
              inventory.tools,
              [],
              "Fresh agent must have zero persisted tools",
            );
            return inventory;
          },
        },
      },
      agentId,
      { timeoutMs: 20_000 },
    );
    const identities = new WeakMap();
    const context = (subject) => {
      const user = { isAuthenticated: true, userName: subject };
      identities.set(user, {
        issuer: "fixture-issuer",
        subject,
        tenant: "fixture-tenant",
        delegation: { hop: 1, allowDelegation: false },
      });
      return new ServerCallContext({ requestedVersion: "1.0", user });
    };
    bridge = createBridge({
      client,
      agentId,
      sharingDomain: "isolated-live-fixture",
      publicBaseUrl: "http://127.0.0.1",
      shutdownTimeoutMs: 3000,
      auth: {
        projectCaller: (ctx) => identities.get(ctx.user),
        authorize: () => true,
      },
      beforeTurn: async (request) => {
        await guard(request.signal);
        guards++;
      },
      sessionOptions: (scope) => {
        assert.equal(guards, observations.length + 1);
        assert(Object.isFrozen(scope.caller));
        assert(Object.isFrozen(scope.caller.delegation));
        assert.equal(scope.caller.issuer, "fixture-issuer");
        assert.equal(scope.caller.tenant, "fixture-tenant");
        assert.deepEqual(scope.caller.delegation, {
          hop: 1,
          allowDelegation: false,
        });
        assert.throws(() => {
          scope.caller.subject = "forged";
        }, TypeError);
        assert.throws(() => {
          scope.caller.delegation.hop = 99;
        }, TypeError);
        const observation = {
          subject: scope.caller.subject,
          key: scope.a2aContextId,
          protocol: scope.protocolContextId,
        };
        observations.push(observation);
        const tool = (name, execute) => ({
          name,
          label: name,
          description:
            name === "fixture_subject"
              ? "Return the authenticated caller subject. No arguments."
              : "A harmless tool the host denies. No arguments.",
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
          execute,
        });
        return {
          options: {
            cwd: process.cwd(),
            toolset: { base: "none" },
            skillSources: [],
            permissionMode: "strict",
            allowedTools: ["fixture_subject", "fixture_denied"],
            canUseTool: async (name) => {
              if (name === "fixture_subject") {
                approved++;
                return {
                  behavior: "allow",
                  updatedInput: null,
                  updatedPermissions: [],
                };
              }
              if (name === "fixture_denied") denied++;
              return {
                behavior: "deny",
                message: "Denied by fixture host policy; do not retry.",
                interrupt: false,
              };
            },
            tools: [
              tool("fixture_subject", async (_id, args) => {
                assert.deepEqual(args, {});
                observation.executed = (observation.executed ?? 0) + 1;
                return {
                  content: [{ type: "text", text: scope.caller.subject }],
                };
              }),
              tool("fixture_denied", async () => {
                forbiddenExecutions++;
                return { content: [{ type: "text", text: "unexpected" }] };
              }),
            ],
          },
          close() {
            observation.conversationId = scope.conversationId;
          },
        };
      },
    });
    const a = context("A"),
      b = context("B");
    const turns = [
      [
        a,
        "Remember codeword saffron. Call fixture_subject exactly once with no arguments. Reply with its result.",
      ],
      [
        a,
        "What codeword did I give you? Answer only the codeword. Do not call tools.",
      ],
      [
        b,
        "Call fixture_denied exactly once. If denied do not retry; reply done.",
      ],
    ];
    const results = [];
    for (const [ctx, text] of turns) {
      stage = `turn ${results.length + 1}`;
      const result = await bounded(
        bridge.requestHandler.sendMessage(
          SendMessageRequest.fromJSON({
            message: {
              messageId: randomUUID(),
              contextId: "same-raw-context",
              role: "ROLE_USER",
              parts: [{ text }],
            },
            configuration: { blocking: true },
          }),
          ctx,
        ),
        50_000,
        stage,
      );
      assert.equal(result.status?.state, TaskState.TASK_STATE_COMPLETED);
      results.push(result);
    }
    stage = "assertions";
    assert.equal(guards, 3);
    assert.equal(inventories, 3);
    assert(
      observations.every(
        (o) =>
          typeof o.conversationId === "string" && o.conversationId.length > 0,
      ),
    );
    assert.equal(
      observations[0].conversationId,
      observations[1].conversationId,
    );
    assert.notEqual(
      observations[0].conversationId,
      observations[2].conversationId,
    );
    assert.equal(observations[0].key, observations[1].key);
    assert.notEqual(observations[0].key, observations[2].key);
    assert(observations.every((o) => o.protocol === "same-raw-context"));
    assert.deepEqual(
      observations.map((o) => o.subject),
      ["A", "A", "B"],
    );
    assert.equal(observations[0].executed, 1);
    assert.equal(approved, 1);
    assert.equal(denied, 1);
    assert.equal(forbiddenExecutions, 0);
    // Require semantic continuity too. memfs:false disables agent memory; do not
    // use stateless:true, which also changes the SDK's transcript behavior.
    stage = "semantic continuity";
    // A2A appends streamed chunks as separate parts; searching serialized JSON
    // incorrectly fails when the provider tokenizes the word as "s" + "affron".
    const continuationText = (results[1].artifacts ?? [])
      .flatMap((artifact) => artifact.parts ?? [])
      .filter((part) => part.content?.$case === "text")
      .map((part) => part.content.value)
      .join("");
    const codewordRecalled = /\bsaffron\b/i.test(continuationText);
    if (!codewordRecalled)
      console.log(
        "PHASE3_REPORT " +
          JSON.stringify({
            diagnostic: "continuation artifact text",
            text: continuationText
              .replaceAll(process.env.OPENAI_API_KEY, "[REDACTED]")
              .slice(0, 500),
          }),
      );
    assert(
      codewordRecalled,
      "A continuation must recall its previous codeword",
    );
    console.log(
      "PHASE3_REPORT " +
        JSON.stringify({
          success: true,
          node: process.version,
          sdk: "0.8.3",
          code: "0.31.7",
          model,
          turns: 3,
          guards,
          inventories,
          immutableCallerAndDelegation: true,
          sameRawContext: true,
          aContinuationSameSdkConversation: true,
          bDifferentSdkConversation: true,
          approved,
          denied,
          forbiddenExecutions,
          codewordRecalled,
          jwtProof: false,
        }),
    );
  } catch (error) {
    // Never print error.message: arbitrary SDK/provider exceptions may hold secrets.
    console.log(
      "PHASE3_REPORT " +
        JSON.stringify({
          success: false,
          stage,
          errorType: error?.name ?? "Error",
        }),
    );
    process.exitCode = 1;
  } finally {
    if (bridge)
      await bounded(bridge.close(), 5000, "bridge close").catch(() => {
        process.exitCode = 1;
      });
  }
  // SDK 0.8.3 management transport has no public disposal method. The supervisor
  // reaps this worker's entire process group, including any management server.
  process.exit(process.exitCode ?? 0);
}

if (process.argv[2] === "--isolated-worker") await worker();
else await supervise();
