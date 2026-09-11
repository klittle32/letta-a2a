// Copied into an isolated npm consumer; never imports repository source.
import assert from "node:assert/strict";
import { readFile, readdir, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
import childProcess from "node:child_process";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import dgram from "node:dgram";

const require = createRequire(import.meta.url);
const expected = JSON.parse(await readFile("expected.json", "utf8"));
const coreOnly = process.argv.includes("--core");
const attempts = [];
const restores = [];
function block(object, key) {
  const original = object[key];
  object[key] = () => {
    attempts.push(key);
    throw new Error(`Unexpected import side effect: ${key}`);
  };
  restores.push(() => {
    object[key] = original;
  });
}
for (const key of [
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
])
  block(childProcess, key);
// Keep subprocess guards active throughout: the trusted fixture must never bootstrap Letta.
const subprocessRestoreCount = restores.length;
for (const [object, keys] of [
  [net, ["connect", "createConnection", "createServer"]],
  [net.Socket.prototype, ["connect"]],
  [http, ["request", "get", "createServer"]],
  [https, ["request", "get", "createServer"]],
  [tls, ["connect", "createServer"]],
  [dgram, ["createSocket"]],
  [globalThis, ["fetch"]],
])
  for (const key of keys) block(object, key);
syncBuiltinESMExports();
const homes = [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "LETTA_HOME",
  "LETTA_CODE_HOME",
];
const snapshot = async () =>
  Promise.all(
    homes.map(async (key) => [
      key,
      await readdir(process.env[key], { recursive: true }),
    ]),
  );
const before = await snapshot();
const clientApi = await import("letta-a2a-client");
assert.equal(typeof clientApi.createA2AClient, "function");
const inert = clientApi.createA2AClient({
  routes: { local: "http://127.0.0.1:1234" },
});
inert.close();
if (coreOnly) {
  assert.throws(() => require.resolve("@letta-ai/letta-agent-sdk"), {
    code: "MODULE_NOT_FOUND",
  });
} else {
  for (const manifest of expected) {
    const installed = join(process.cwd(), "node_modules", manifest.name);
    assert.equal(
      (await lstat(installed)).isSymbolicLink(),
      false,
      "Must install actual tarball, not host symlink",
    );
    const actual = JSON.parse(
      await readFile(join(installed, "package.json"), "utf8"),
    );
    assert.equal(actual.name, manifest.name);
    assert.equal(actual.version, manifest.version);
    for (const [key, entry] of Object.entries(actual.exports)) {
      await import(actual.name + (key === "." ? "" : key.slice(1)));
      assert.ok(
        (await readFile(join(installed, entry.types), "utf8")).length > 0,
      );
    }
    for (const mod of actual.letta?.mods ?? []) {
      const loaded = await import(pathToFileURL(join(installed, mod)).href);
      assert.equal(
        typeof loaded.default,
        "function",
        "Mod must export inert activation",
      );
      const registered = [],
        removed = [],
        diagnostics = [];
      const host = {
        capabilities: { tools: false },
        diagnostics: { report: (entry) => diagnostics.push(entry) },
        tools: {
          register: (tool) => {
            registered.push(tool);
            return () => removed.push(tool.name);
          },
        },
      };
      assert.equal(loaded.default(host), undefined);
      assert.equal(registered.length, 0);
      process.env.LETTA_A2A_ROUTES = JSON.stringify({
        fixture: "http://127.0.0.1:1234",
      });
      try {
        host.capabilities.tools = true;
        const dispose = loaded.default(host);
        assert.equal(typeof dispose, "function");
        assert.deepEqual(registered.map((tool) => tool.name).sort(), [
          "a2a_invoke",
          "a2a_task",
        ]);
        assert.ok(registered.every((tool) => tool.requiresApproval === true));
        dispose();
        dispose();
        assert.deepEqual(removed.sort(), ["a2a_invoke", "a2a_task"]);
        assert.deepEqual(diagnostics, []);
      } finally {
        delete process.env.LETTA_A2A_ROUTES;
      }
    }
  }
}
assert.deepEqual(
  await snapshot(),
  before,
  "Imports must not populate isolated agent homes",
);
assert.deepEqual(attempts, []);
while (restores.length > subprocessRestoreCount) restores.pop()();
syncBuiltinESMExports();

if (coreOnly) {
  console.log(
    JSON.stringify({
      optionalSdkAbsent: true,
      coreImport: true,
      inertConstruction: true,
    }),
  );
} else {
  const { createBridge, listenLoopback, DurableBinding } = await import(
    "letta-a2a-bridge"
  );
  const { SendMessageRequest, GetTaskRequest, TaskState } = await import(
    "@a2a-js/sdk"
  );
  const { ClientFactory } = await import("@a2a-js/sdk/client");
  const options = {
    directory: resolve("durable"),
    bindingId: "packed-fixture",
  };
  let calls = 0;
  const contexts = [];
  const runner = {
    async runTurn(request) {
      calls++;
      contexts.push(request.a2aContextId);
      return { text: "harmless local fixture", state: "input_required" };
    },
  };
  let bridge, listener, service, state;
  const start = async () => {
    state = await DurableBinding.open(options);
    bridge = createBridge({
      sharingDomain: "packed-fixture",
      publicBaseUrl: "http://127.0.0.1",
      runner,
      durability: state,
    });
    listener = await listenLoopback(bridge, { port: 0 });
    return new ClientFactory().createFromUrl(listener.url);
  };
  const message = (messageId, taskId, contextId) =>
    SendMessageRequest.fromJSON({
      message: {
        messageId,
        taskId,
        contextId,
        role: "ROLE_USER",
        parts: [{ text: "local fixture only" }],
      },
    });
  try {
    let wire = await start();
    await assert.rejects(
      DurableBinding.open(options),
      /owner|lock|already|held/i,
    );
    const first = await wire.sendMessage(message("packed-one"));
    assert.ok(first.id);
    assert.equal(first.status.state, TaskState.TASK_STATE_INPUT_REQUIRED);
    assert.equal(
      (await wire.getTask(GetTaskRequest.fromJSON({ id: first.id }))).id,
      first.id,
    );
    assert.equal((await listener.close()).complete, true);
    listener = undefined;
    wire = await start();
    assert.equal(
      (await wire.getTask(GetTaskRequest.fromJSON({ id: first.id }))).id,
      first.id,
    );
    await assert.rejects(wire.sendMessage(message("packed-one")), /duplicate/i);
    assert.equal(calls, 1);
    const continued = await wire.sendMessage(
      message("packed-two", first.id, first.contextId),
    );
    assert.equal(continued.id, first.id);
    assert.equal(continued.contextId, first.contextId);
    assert.equal(contexts[1], contexts[0]);
    assert.equal(calls, 2);
    // Exercise the packed client library, not only the official wire client.
    service = clientApi.createA2AClient({
      routes: { fixture: listener.url },
      timeoutMs: 10_000,
      pollIntervalMs: 10,
    });
    const input = {
      target: "fixture",
      localScope: "consumer",
      message: "harmless",
      signal: AbortSignal.timeout(15_000),
    };
    const task = await service.invoke(input);
    assert.ok(task.id);
    assert.equal(
      (
        await service.task({
          target: "fixture",
          localScope: "consumer",
          taskId: task.id,
          action: "get",
        })
      ).id,
      task.id,
    );
    const next = await service.invoke({
      ...input,
      taskId: task.id,
      message: "continue",
    });
    assert.equal(next.contextId, task.contextId);
    assert.equal(calls, 4);
    assert.deepEqual(attempts, []);
  } finally {
    service?.close();
    if (listener) assert.equal((await listener.close()).complete, true);
    else if (bridge) assert.equal((await bridge.close()).complete, true);
    else if (state) await state.close();
  }
  console.log(
    JSON.stringify({
      exports: true,
      importSideEffects: false,
      packedMod: [
        "import",
        "capability-guard",
        "activation",
        "approval-flags",
        "disposal",
      ],
      loopback: ["send", "get", "continuation", "shutdown"],
      durable: ["reopen", "dedup", "owner-refusal"],
      trustedRunnerCalls: calls,
      realBackend: false,
    }),
  );
}
