# Letta A2A client

Unpublished MIT-licensed `0.1.0-alpha.1` candidate. Node 24.19.0 is the tested baseline; Bun 1.4.2 is build-only. See the [release/support guide](https://github.com/klittle32/letta-a2a/blob/main/docs/RELEASING.md) before adoption. The bundled SDK retains its own license in `THIRD_PARTY_NOTICES.md`.

A lossless A2A 1.0 client library, with thin Letta Code mod and Letta Agent SDK tool adapters. Uses the official `@a2a-js/sdk` 1.1.0; imports do not start a server, create an agent, or install a mod. This is an unpublished local package under active development.

## Library

```ts
import { createA2AClient, FileContextStore } from "letta-a2a-client";

const remote = createA2AClient({
  routes: { peer: "http://127.0.0.1:41241" },
  contextStore: new FileContextStore("./state/a2a.json"),
  timeoutMs: 120_000,
});
const result = await remote.invoke({
  target: "peer",
  message: "Hello", // Or an official SDK Message, including typed parts.
  localScope: "application-owned-session-id",
  signal: AbortSignal.timeout(120_000),
});
// result is the original SDK Message | Task, not a flattened text substitute.
remote.close();
```

Omitting `contextStore` selects an in-memory store. `invoke` polls until terminal **or interrupted**, retains original parts/artifacts/status/history, and supports `contextId`, `taskId`, and `newContext`. A context selects a new task in that conversation; an interrupted task requires `taskId` to continue the existing task. Conflicting selections fail before sending.

`remote.task({ target, localScope, taskId, action: "get" | "cancel", signal })` reads or requests cancellation without waiting behind an active invocation. `connect(target, signal)` returns the policy-bound **official SDK Client**, exposing discovery, typed sends/SSE, listing, subscription, and peer-enabled push methods without another protocol wrapper:

```ts
const peer = await remote.connect("peer", signal);
const card = await peer.getAgentCard({ signal });
for await (const event of peer.sendMessageStream(request, { signal })) {
  // Original SDK StreamResponse; preserve task/status/artifact boundaries.
}
```

Direct SDK calls have caller-owned lifetimes and are **not** automatically serialized or journaled by `remote.invoke`. Pass an `AbortSignal`, close abandoned iterators, and use `GetTask` after stream loss. EOF is not proof of completion. The lower-level `PollingA2AInvoker` additionally supplies bounded `stream` and `subscribe` helpers: abandoning a send requests cancellation; abandoning a subscription only detaches it.

## Letta Agent SDK tools

Import the optional adapter separately. The SDK is a pinned optional peer (`0.8.3`), not a runtime dependency of the core/mod entry.

```ts
import { createA2ATools } from "letta-a2a-client/agent-sdk";

const owner = new AbortController();
let conversationId: string | undefined;
const tools = createA2ATools({
  client: remote,
  getScope: () => ({ agentId, conversationId }),
  signal: owner.signal,
});
await using session = letta.createSession(agentId, {
  tools: tools.tools,
  allowedTools: tools.tools.map(tool => tool.name),
  permissionMode: "strict",
  // Supply your application's canUseTool policy; the adapter never auto-allows.
  canUseTool,
});
try {
  conversationId = (await session.ready()).conversationId;
  await session.send("Ask the configured peer for help.");
  for await (const message of session.stream()) {
    // Consume public application output.
  }
} finally {
  owner.abort();
  await tools.close();
}
```

`agentId`, `letta`, and `canUseTool` above belong to the application. Bind the actual ready conversation, not a guessed ID or model argument. Create a fresh group for each recreated SDK session/connection. SDK session options own registration; the adapter does not install a global mod or widen permissions.

**SDK 0.8.3 does not forward a per-tool cancellation signal to `execute`.** The explicit owner signal and awaited `close()` are required. Group disposal aborts its calls and waits for their actual local operation/persistence drain within a bound; incomplete cleanup rejects. It neither closes the shared client nor claims an unconfirmed remote cancellation succeeded. Transparent mid-turn transport recovery is not promised.

## Letta Code mod

Build, then install from the repository root:

```bash
(cd packages/letta-a2a-client && bun install --frozen-lockfile && bun run check)
letta install ./packages/letta-a2a-client
```

Run `/reload`. Create `~/.letta/a2a-client.json`:

```json
{
  "routes": { "peer": "http://127.0.0.1:41241" },
  "pollIntervalMs": 500,
  "timeoutMs": 120000
}
```

`LETTA_A2A_ROUTES` can supply temporary routes as JSON. `LETTA_A2A_CONFIG` and `LETTA_A2A_CONTEXT_STORE` override the configuration and state paths. Invalid configuration leaves visible tools returning an actionable error without connecting.

Both adapters expose the same two tools:

```text
a2a_invoke(target, message, context_id?, task_id?, new_context?)
a2a_task(target, task_id, action: "get" | "cancel")
```

Arguments are runtime-validated. Agent/conversation identity comes from the host. Mod tools require host approval and are not marked parallel-safe; receiving agents must still govern consequential actions. Tool results are bounded valid JSON with task/context IDs, status, separate status text, text/artifact/part summaries, and explicit omission markers. Failures preserve partial output. Working/input-required/auth-required states are not mislabeled as terminal failures. The underlying library result is never truncated.

## Continuity, recovery, and ownership

- Bindings use the local scope and canonical endpoint, not a route nickname. Same-URL aliases share continuity; changing a route's endpoint does not inherit its previous context.
- Execution locks use the actual remote context across local scopes. File stores coordinate cooperating processes using the **same state path**. Separate files/stores do not coordinate; this is not a distributed or remote-owner lease.
- State contains correlation/controller metadata, not credentials or message/artifact payloads. Writes are atomically replaced; pending message identity is recorded before sending and accepted IDs are recorded early.
- Unknown submission is distinct from an accepted working/interrupted task, including uncertain same-task followups. An old interrupted snapshot is not permission to replay a lost send. Reconciliation needs correlated evidence; no automatic submission retries.
- Deadlines cover queue waits, storage-facing waits, discovery, invocation, and bounded remote cancellation. Noncooperative local work may outlive the returned error; its ownership locks remain held until actual settlement. `drain(signal)` lets an owner await those operations separately.
- Cancellation requested is not cancellation confirmed. Retain readback IDs and reconcile before another turn in an unresolved context.
- File locks are **never stolen by age**. After a crash, remove an orphan lock only after verifying its owner is gone; preserve the state journal and reconcile remote execution before reuse. Automatic crash recovery is not implemented.
- Legacy `localScope/target` mappings lack endpoint identity. They remain intact, but require explicit `context_id` migration after confirming the route, or a deliberate `new_context`; they are not silently reused against a changed destination.

## Boundary and development

Only named trusted HTTP(S) routes are accepted by the composed client. Configured URLs cannot contain credentials, queries, or fragments. Without an explicit policy, discovery and advertised/actual endpoints must stay on the configured origin. Redirects are rejected.

Host applications can supply `routePolicies` keyed by route name. A policy separates approved destination origins from credential origins and binds continuity to a stable peer and caller identity:

```ts
const owner = { issuer: "https://issuer.example", subject: "application", audience: "remote-a2a" };
const remote = createA2AClient({
  routes: { peer: "https://peer.example" },
  routePolicies: {
    peer: {
      peerIdentity: "peer-agent",
      destinationOrigins: ["https://peer.example"],
      credential: {
        owner,
        audience: "remote-a2a",
        origins: ["https://peer.example"],
        headerNames: ["Authorization"],
        async provide({ signal, audience }) {
          // Application-owned OAuth exchange/cache; do not put credentials in JSON config.
          const token = await tokenProvider.getAccessToken(signal);
          return { owner, audience, headers: { Authorization: `Bearer ${token}` } };
        },
      },
      headers: { "x-letta-a2a-hop": "1" }, // Only for an authenticated delegate.
    },
  },
});
```

The provider must confirm the configured logical owner and audience on each call. Rotated tokens preserve identity; changed owner/audience fails closed. This confirmation is a trusted application contract, not JWT validation by the package. The receiving application must validate the credential. Token providers, authorization servers, and their secret storage remain outside this package.

Policy credentials and trusted headers cannot be overridden through the official client's per-call `serviceParameters`. Credential acquisition is bounded; failed authentication does not cause an automatic send retry. Same-URL aliases must agree on policy and provider identity. Use separate client instances for different owners; their hashed stable identity namespaces prevent one from inheriting the other's stored contexts. Mod JSON configuration remains anonymous; authenticated policy is supplied through host code, not model arguments.

`fetchImpl` is a **trusted extension**, not a sandbox. A custom fetch implementation must honor request headers, redirect restrictions, signals, and response cleanup. Custom `ContextStore.withLock` implementations must serialize matching keys, reject canceled waiters before invoking their work, and retain ownership until started work actually settles.

This policy is not general SSRF/DNS-rebinding protection, server-side authorization, or remote execution enforcement. The peer must implement truthful A2A identity/task semantics.

The client can carry all SDK part types; the separate initial bridge profile still executes text only. Neither package silently adds an inbound listener to an ordinary Letta session.

```bash
cd packages/letta-a2a-client
bun install --frozen-lockfile
bun test
bun run check
```

Build emits ordinary Node ESM/declarations under `dist/lib` and the self-contained mod at `dist/a2a-client.mjs`. See the [package plan](../../docs/LETTA_A2A_PACKAGES_PLAN.md) and dated evidence for executed coverage and remaining release gates.
