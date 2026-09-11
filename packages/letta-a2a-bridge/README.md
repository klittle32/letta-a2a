# letta-a2a-bridge

Phase 1 extraction of Example 14, using `@a2a-js/sdk` **1.1.0** and `@letta-ai/letta-agent-sdk` **0.8.3**. This is a narrow anonymous, loopback, text-only, in-memory profile—not the full package-plan release or multi-tenant hosting.

## Compose an existing agent

```ts
import { createBridge, createToolPolicy, listenLoopback } from "letta-a2a-bridge";

// The application supplies its LettaAgentClient and explicitly selected agent ID.
// First establish persisted-tool governance; client allowlists alone cannot do it.
const bridge = createBridge({
  client,
  agentId,
  sharingDomain: "my-local-app",
  publicBaseUrl: "http://127.0.0.1:41241",
  sessionOptions: { ...createToolPolicy([]), cwd: process.cwd() },
});
const listener = await listenLoopback(bridge, { port: 41241 });
const result = await listener.close();
if (!result.complete) console.error("Cleanup requires attention", result);
```

Imports never create agents, start listeners, install mods, or register process hooks. The client remains application-owned. Example 14 owns its explicit agent-create/reuse logic and dedicated tool-free fixture guard; that guard is **not** a universal package policy. `createToolPolicy(names)` provides strict, noninteractive client-tool approval/denial primitives. Explicit `sessionOptions` may instead configure an application's legitimate existing tools, but the application must establish their persisted/server-side governance before binding the runtime. Incoming text cannot grant approval.

For session-owned tools, `sessionOptions` may be a factory receiving `SessionScope` (`agentId`, live ready `conversationId`, and the turn's `signal`). Return `{ options, close? }`: options configure that fresh SDK session; awaited cleanup disposes its application-owned resources. SDK 0.8.3 does not pass a per-call signal to external tools, so the client adapter needs this explicit lifecycle. A cleanup failure quarantines a sent turn's context rather than silently treating disposal as complete. See Example 14 for direct `letta-a2a-client/agent-sdk` composition.

## Library boundary

- `createBridge` returns the official `DefaultRequestHandler` with a narrow new-task-only guard on its two send methods, plus the executor, generated card, and `close`. It accepts the official `TaskStore`; the default is `InMemoryTaskStore`. SDK call contexts reach that store without replacement.
- `AgentSdkTurnRunner(client, agentId, policy)` owns a dedicated in-memory A2A-context → Letta-conversation mapping. Share **one runner per binding** across any local handler compositions. Never create competing execution owners for the same binding, including in another process. This extraction has no distributed lease or cross-process enforcement.
- `LettaAgentExecutor(runner, shutdownTimeoutMs?)` implements the official `AgentExecutor`. Applications can compose it directly with official handlers/transports. A tiny `LettaTurnRunner` interface supports deterministic tests; successful return or `LettaTurnCancelledError` must mean the underlying turn has actually stopped.
- `listenLoopback` uses official Express card/JSON-RPC middleware and binds only `127.0.0.1`. Port zero is supported; discovery advertises the allocated URL. Custom authenticated/non-loopback deployment is not supported by this profile.
- `readText`, `textPart`, and `agentMessage` use official message/part types. Mixed or unsupported input is rejected as a whole before calling Letta. Requested output modes must permit `text/plain`.

The sharing domain is an explicit ownership contract for **all local anonymous callers**, not an identity credential. The executor refuses nonempty tenants and authenticated call contexts instead of accidentally reusing their conversations. The SDK's task-owner seam remains intact, but this package does not yet provide authorized per-caller context mapping. Do not expose the handler to mutually untrusted callers, even through a gateway. Conversations share agent memory.

## Lifecycle and limits

Each context gets a dedicated conversation, resumed in later **new tasks**. Incoming task IDs are rejected before SDK dispatch in this profile, so a follow-up cannot overwrite an active task's cancellation ownership. The runtime keeps the predecessor's barrier when a queued waiter is canceled. Different contexts can run concurrently. The mapping creates no aliases to the same conversation; callers cannot supply an existing conversation ID.

Streaming emits public assistant text only, with stable artifact identity and append/final-chunk flags. Failures retain partial chunks as nonfinal and expose a sanitized status message—not raw exceptions or SDK errors. No automatic replay follows an ambiguous send, missing/unsuccessful result, pending approval, or failed session disposal: that context is quarantined for this runner's lifetime. The SDK can synthesize failed results on disconnection; they do not prove execution stopped. An explicit SDK `interrupted` result confirms cancellation only after disposal settles. Other unsuccessful results are conservatively quarantined, including errors that might have ended cleanly. Operational recovery is deliberately manual; do not replace the runner and replay without reconciling the old execution.

`bridge.close()` and `listener.close()` are asynchronous and idempotent. They stop acceptance, request active/queued cancellation, and wait up to `shutdownTimeoutMs` (default 5000). The listener then closes remaining HTTP connections. A timed-out turn keeps its context serialization barrier until the actual stream and async disposal settle; shutdown never releases it on the timer. The result contains `complete`, `pendingTaskIds`, and `unresolvedContextIds`. Repeated close returns the same promise/result, not a refreshed recovery assessment. Library code never calls `process.exit()`.

Task history/artifact processing and transport behavior are SDK-owned. This phase does **not** claim a complete wire-error conformance matrix: unsupported input/output and unsupported identity-bearing execution currently yield a failed task rather than a protocol media/authorization error. Same-task interrupted continuation, input/auth outcomes, push, durability/restart recovery, authenticated ownership, REST/gRPC, extended cards, retention, and multi-process ownership are deferred. Supplying a durable task store alone does not make the bridge durable.

## Validate without providers

```bash
bun install --frozen-lockfile
bun test tests
bun run build
node -e 'import("./dist/index.js").then(() => console.log("import ok"))'
```

Build before installing Example 14's `file:` dependency. The package exports Node ESM and declarations from `dist/`; Bun is a development/test tool, not a runtime requirement. Deterministic tests use local fake SDK sessions and runners; no module mocks or live providers are needed.
