# letta-a2a-bridge

A text-only A2A 1.0 JSON-RPC/SSE bridge using `@a2a-js/sdk` **1.1.0** and `@letta-ai/letta-agent-sdk` **0.8.3**. Phase 3 adds authenticated ownership, interrupted-task continuation, subscription, push, and application policy seams. This is not yet the full package-plan release or a durable multi-tenant hosting service.

## Compose an existing agent

```ts
import { createBridge, createToolPolicy, createAgentToolGuard, listenLoopback } from "letta-a2a-bridge";

const guard = createAgentToolGuard(client, agentId, { allowedToolIds: [] });
const bridge = createBridge({
  client,
  agentId,
  sharingDomain: "my-local-binding",
  publicBaseUrl: "http://127.0.0.1:41241",
  beforeTurn: request => guard(request.signal),
  sessionOptions: { ...createToolPolicy([]), cwd: process.cwd() },
});
const listener = await listenLoopback(bridge, { port: 41241 });
const result = await listener.close();
if (!result.complete) console.error("Cleanup requires attention", result);
```

Imports create no agents, listeners, global mods, or process hooks. The application supplies and owns its client and existing agent. `createAgentToolGuard` reads the current agent inventory before each invocation and rejects unapproved persisted **tool IDs**, missing identity, or unavailable inventory. It never removes tools. Use its explicit allowlist for legitimate existing tools. This is a read-only preflight, not an atomic lock against other administrators changing agent configuration.

`beforeTurn` runs inside the context execution lock, before SDK setup. `createToolPolicy(names)` separately provides strict, noninteractive connection-owned tool approval; it does not govern persisted server tools. Incoming text cannot grant approval. An application may supply a different explicit session policy when needed.

For session-owned tools, `sessionOptions` accepts a factory receiving `SessionScope`: agent ID, immutable trusted caller/delegation, scoped and original protocol context IDs, message ID, live ready conversation-ID getter, and turn signal. Return `{ options, close? }`; awaited cleanup disposes owned resources. SDK 0.8.3 does not pass a per-call signal to external tools, so adapters require the explicit owner signal. Failed disposal quarantines sent work. Avoid SDK `stateless` mode when durable transcript behavior is required; the live continuity fixture uses ordinary sessions.

## Authentication and authorization

Without `auth`, only the explicit shared anonymous loopback profile is permitted. Its callers are one trust domain, not independent identities. Authenticated applications supply:

- `transport.middleware` and `transport.userBuilder`: validate credentials and produce application-verified SDK users. JWT verification, issuer/audience/expiry/scope policy, token exchanges, and secrets remain application-owned.
- `auth.projectCaller(context)`: project verified issuer, subject, tenant, and optional `{ hop, allowDelegation }`. Never derive authority from message metadata or unchecked headers.
- `auth.authorize({ caller, operation, params, context })`: authorize **every** operation, including discovery and push registration. Read token-specific claims from this request's original verified `context`. Never cache token scopes by principal: two simultaneous tokens for one principal may grant different permissions.
- `security`: the actual Agent Card security schemes and requirements. No OAuth/Bearer advertisement is guessed from a callback; supply the truthful declaration when exposing an authenticated endpoint.

The package snapshots principal identity and projects binding/issuer/subject/tenant into the official SDK owner/tenant seams. Wire tenant conflicts reject; caller metadata cannot choose another owner or SDK conversation. Task ownership is established before shared execution reservations. Protected discovery uses private/no-store responses. Gateway authentication alone is not a replacement for the direct-endpoint policy.

`sharingDomain` identifies the binding as well as the anonymous trust domain. Use distinct values for independent bindings sharing storage. Custom task/push stores are trusted adapters and must honor projected SDK owner and tenant scope. Separate caller conversations still share **one agent's memory**; use separate agents/runtimes for mutually untrusted memory domains.

See [`tests/packages-phase3.test.ts`](../../tests/packages-phase3.test.ts) for executable application-owned OAuth composition, including negative credentials and concurrent scope isolation. `listenLoopback` binds only `127.0.0.1`; other hosting/TLS remains application composition.

## Protocol and lifecycle

`createBridge` returns a policy-guarded official-handler facade, executor, card, and asynchronous `close`. The SDK owns protocol serialization, task history/artifacts, task/list filtering, and push RPCs. The default task store is in-memory.

`createBridgeRouter(bridge, options?)` exposes the same policy-aware Express composition for application-owned mount paths/listeners. `listenLoopback` consumes it. Custom hosts own socket/TLS policy and must not expose the shared anonymous profile to untrusted callers.

`AgentSdkTurnRunner` optionally accepts `policy.conversationMapping.get/set`. The runner passes only its owner-scoped key, awaits reads/writes inside serialization, and persists the ready conversation ID before submission. The default remains in-memory. A custom mapping adapter is trusted; saved IDs support idle continuity, not task recovery or safe replay after a crash. Persistence failures do not release still-running work early.

- Text-only input/output is declared; unsupported or mixed input fails with a protocol media error before execution.
- `contextId` starts a new task in that caller's conversation. `taskId` resumes only an explicitly settled input/auth interruption. Active, terminal, duplicate, conflicting-context, or unknown-recovery execution rejects before dispatch.
- Trusted custom runners return `{ text, state: "input_required" | "auth_required", detail? }` only after execution has settled. `detail` is public. Assistant prose never creates an interruption. The default SDK runner does not reinterpret pending tool approval as safely resumable execution.
- Streams emit public assistant artifacts, not hidden reasoning. Failed partial output stays nonfinal. Disconnecting does not cancel work: the official handler continues consuming for task persistence. Subscription begins with the current snapshot and rejects terminal tasks.
- A2A SDK 1.1.0 keeps auth-required queues open. A settled runner interruption finishes the official event bus without changing its wire state, preventing a stale consumer from processing the next turn.
- Unknown SDK execution/disposal outcomes quarantine the context. No automatic replay, cross-process ownership takeover, or recovery certainty is invented. Restored work without a live execution owner cannot be canceled through the SDK's missing-bus shortcut.

Share one runner/execution owner per binding. Context serialization remains held until actual execution and disposal settle, even after timeout. Duplicate-message and interruption state currently have process-lifetime retention; there is no retention service or distributed lease.

## Delegation and push

`delegationPolicy` validates explicit `a2a_invoke` intent, asynchronous submission, authenticated delegate role, and canonical `x-letta-a2a-hop` (default maximum one). The application verifies the role/header, projects its decision onto `TrustedCaller.delegation`, and uses it to withhold or deny outbound tools. Supply the returned outbound headers through the client package's **host-owned** route policy, never model arguments. This is an application policy convention, not a new A2A field. Service migration/legacy metadata convergence remains Phase 4.

`createPushNotifications({ callbacks: [{ url, bearerToken }], ...bounds })` returns official `{ store, sender, close }` seams; pass the whole object as `push`. Registrations require an exact host-approved URL/Bearer pair. Redirects are rejected; retries and delivery/close waits are bounded. SDK V1 serialization, per-task ordering, and correlation events are retained. Protocol-facing create/load results redact tokens and credentials; trusted `loadWithMetadata` intentionally retains credentials for delivery. Callback URLs are public and must not embed secrets.

The default push owner resolver uses the SDK user name. Through this bridge that name includes binding/issuer/subject; tenant is also scoped. When using the helper independently, provide an appropriate resolver—raw SDK anonymous users share a scope. Custom fetch/resolver implementations are trusted extensions, not sandboxed transports.

`bridge.close()`/`listener.close()` are bounded and idempotent. They stop execution acceptance, request cancellation, and close supplied push resources. Results contain `complete`, pending task IDs, unresolved context IDs, and optional push cleanup status. A pending/rejected push close prevents a complete result. Without a push close hook, push cleanup remains application-owned and is not covered by that result. Repeated close returns the original assessment, not a later recovery check. Library code never exits the process.

## Validation and remaining scope

```bash
bun install --frozen-lockfile
bun test tests
bun run check
bun run build
node -e 'import("./dist/index.js").then(() => console.log("import ok"))'
```

Run the root test suite for cross-package HTTP/OAuth proofs. Build both packages before refreshing Example 14's `file:` dependencies. Node ESM/declarations come from `dist/`; Bun is a development tool, not a runtime requirement.

Extended cards remain explicitly disabled; the official client supports capable peers. The lab service now consumes these packages; see the root Phase 4 evidence. REST/gRPC, arbitrary extensions/signatures, rich Letta input execution, durable recovery, multi-process enforcement, broad OS/backend validation, publication, and production deployment are not claimed. A durable task store alone does not make this bridge durable.
