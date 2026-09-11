# Letta A2A packages plan

## Goal

Deliver full-featured, bidirectional A2A support for Letta Code and Letta Agent SDK applications through two small, reusable packages:

1. **`letta-a2a-client`** — discover and communicate with remote A2A agents, with thin Letta Code mod and Agent SDK tool adapters.
2. **`letta-a2a-bridge`** — expose a persistent Letta agent through the official A2A server and Letta Agent SDKs.

The code should be concise, clean, and easy to maintain and reason about. The governing principle is:

> Preserve protocol capability in the library; keep the Letta integrations small and convenient.

```text
Outbound
Letta Code mod ─┐
                ├─▶ letta-a2a-client ─▶ remote A2A agent
Agent SDK tool ─┘

Inbound
A2A client ─▶ letta-a2a-bridge ─▶ Letta Agent SDK ─▶ persistent Letta agent
```

`agentgateway` is an optional routing, TLS, authentication, and policy layer. Direct deployments must use the same core semantics without requiring it.

This document defines the implementation scope and release gates. Approval of this plan is not authorization to publish, deploy, or push changes.

The verified Phase 0 baseline, SDK method mapping, ownership rules, and regression ownership are recorded in [the implementation contracts](LETTA_A2A_CONTRACTS.md).

Progress: [Phase 0/1 checkpoint](evidence/2026-09-11-a2a-packages-phase-0-1.md), [Phase 2 client/adapter checkpoint](evidence/2026-09-11-a2a-packages-phase-2.md), [Phase 3 protocol/policy checkpoint](evidence/2026-09-11-a2a-packages-phase-3.md). Acceptance boxes below remain full-release gates, not blanket claims about these checkpoints. Phase 4 service convergence is next; no service migration or publication is implied by Phase 3.

## Starting assets and limitations (before implementation)

| Existing surface | Reuse | Do not assume |
| --- | --- | --- |
| `packages/letta-a2a-client/` | Packaged mod, official client, polling, cancellation, named routes, durable context mapping | Full task continuation, lossless content, or cross-process execution serialization; file-write locking alone does not serialize invocations |
| `examples/14-typescript-letta-agent-sdk/` | Small SDK composition, executor, conversation mapping, assistant streaming, cancellation, restrictive tool policy | Production recovery, caller isolation, or permission to copy every implementation detail unchanged |
| `services/bridge/` | OAuth/gateway composition, delegation policy, streaming, push delivery, multi-agent fixture | Durable A2A tasks: the service uses `InMemoryTaskStore`; its persisted context map is a separate guarantee |
| `tests/`, `scripts/`, Example 13 and `a2acli` | Deterministic fixtures, provider-backed evidence, independent cross-language client | Complete protocol conformance merely because existing demonstrations pass |

Consolidate these implementations rather than rewrite them. Task lifecycle completion, ownership enforcement, and in-flight recovery are explicit new work.

## Architecture and maintainability rules

| Component | Owns |
| --- | --- |
| Official A2A SDK | Protocol types, methods, transport machinery, request handling, task/event primitives, and supported extension interfaces |
| Client package | Connection and credential policy, continuity, lifecycle convenience operations |
| Bridge package | A2A-to-Letta translation, authorized conversation mapping, execution correlation, recovery |
| Letta adapters | Tool registration, trusted session scope, model-readable projections |
| Deployment composition | Credentials, identity-provider wiring, gateway routes, operating configuration |

- Use official SDK types and interfaces wherever possible. Do not introduce a parallel protocol model, task state machine, transport layer, or generic middleware framework.
- Keep protocol data lossless in the library. Concision belongs in convenience APIs and presentation, not in silently discarded content.
- Keep policies explicit at their enforcement point. Hooks must have narrow inputs, documented failure behavior, and a concrete caller; avoid speculative extension systems.
- One Letta agent binding per bridge instance; independent instances may share a process, but not hidden global state. Start with one execution-owning process per binding, not a distributed scheduler.
- Prefer a few cohesive modules over a predetermined directory tree. Separate code when ownership or actual reuse requires it, not to satisfy this document's layout.
- Keep two packages under `packages/`, each with library exports and tests. The client also has a bundled mod entry; the bridge has a small CLI composition. Add no shared-contracts or testkit package without demonstrated need.
- Test first, then make the smallest passing change. Extract intended behavior, not accidental bugs. Keep correctness fixes separate from mechanical moves where practical.

## Protocol scope and conformance contract

The initial release target is **A2A 1.0 over JSON-RPC, with polling and SSE streaming in both library directions**. Polling remains the default model-tool workflow, not a limit on the client library.

Full-featured means explicit method and lifecycle coverage within the declared profile. It does not mean every optional binding or every Letta model supports every content type. Do not equate use of the official SDK with tested package conformance.

### Method and capability inventory

Phase 0 must verify exact methods, capability rules, and error semantics against the pinned official specification and SDK. This inventory is the release contract, not an instruction to reimplement SDK behavior.

| Surface | Client library | Bridge | Required evidence |
| --- | --- | --- | --- |
| Agent Card discovery | Required | Required | Version, interface selection, advertised capabilities and content modes match configuration |
| `SendMessage` | Required | Required | Immediate `Message` or `Task` response; blocking and `returnImmediately` modes; accepted output modes |
| `GetTask` | Required | Required | Authorized snapshot; history limits including zero; unknown task |
| `ListTasks` | Required | Required | Ownership, supported filters, pagination, artifact inclusion |
| `CancelTask` | Required | Required | Queued/running tasks, completion races, non-cancelable tasks, actual execution cleanup |
| `SendStreamingMessage` | Required | Required | Ordered status/artifact events, append/final-chunk semantics, failure after partial output |
| `SubscribeToTask` | Required | Required | Current snapshot, disconnect/resubscribe, supported active/interrupted states, terminal-task behavior |
| Existing-task continuation | Required | Required | Follow-up with the same task ID; context agreement; unknown and terminal task rejection |
| Push-configuration create/get/list/delete methods | Required when peer supports push | Required in push-enabled profile | Ownership, callback validation, configuration lifecycle, delivery/retry/deduplication behavior |
| Authenticated extended Agent Card | Explicitly deferred initially | Explicitly deferred initially | Never advertise support while deferred; preserve SDK extension seam |
| Additional REST/gRPC bindings, card signatures, arbitrary extensions | Explicitly deferred initially | Explicitly deferred initially | Document unsupported behavior; no custom substitutes |

Push-enabled, authenticated, and durable profiles are required deliverables for the package effort, although they are not enabled in the minimal local example. Optional protocol features must not become accidental requirements of every deployment.

### Lifecycle and content invariants

- **Task continuation is not context continuation.** A new task may reuse a context; an interrupted task resumes using its existing task ID. Both must be expressible without reconstructing hidden state.
- `completed`, `failed`, `canceled`, and `rejected` are terminal. `input-required` and `auth-required` are interrupted, not completed or failed. Convenience polling returns control on interruption instead of waiting until timeout or canceling the task.
- Preserve task/context IDs, typed message parts, artifact identity and boundaries, metadata, and status messages. Partial output must never mask failure or an input/authentication request.
- Use official content types for text, structured data, and file/URL parts in the client core. Preserve them without automatically fetching remote files or interpreting arbitrary data as executable instructions.
- The initial bridge execution profile is text-only. Reject unsupported or mixed input explicitly before sending to Letta; do not silently strip nontext parts. Validate requested output modes and advertise only what the configured bridge can produce. Additional content translation is a separate, tested profile.
- Preserve interrupted states from remote agents. For inbound work, define explicit application/session outcomes that can request input or authentication; do not infer protocol state from natural-language assistant wording. Ordinary authentication failure remains an HTTP/protocol authorization error, not automatically `auth-required`.
- Keep errors and generated content separate. Expose stable, sanitized failure information; hidden reasoning, raw internal events, credentials, and unsanitized exception details stay private.

## Identity, authorization, and conversation ownership

These contracts precede storage extraction and authentication-provider implementations.

### Inbound identity

An incoming A2A context receives a **dedicated conversation on the configured existing Letta agent**. Continuing that context resumes the authorized mapping. It does not inject messages into whichever terminal conversation happens to be open.

- Context ownership includes the bridge/agent binding and a trusted principal or explicitly configured sharing domain. Preserve authenticated SDK request context through task-store and handler operations.
- An identifier is not authority. Authorize creation, continuation, get/list/cancel, subscriptions, and push-configuration access consistently. Reject cross-owner access rather than silently attaching it to another conversation.
- Anonymous loopback mode is one shared trust domain, not multi-tenant isolation. Non-loopback serving requires an explicit authenticated deployment or a documented trusted-gateway boundary; fail closed on missing identity.
- Gateway identity is trusted only through a configured, protected boundary. Caller-supplied metadata or arbitrary forwarded headers cannot impersonate a principal.
- Separate conversations on one Letta agent still share that agent's memory. Conversation authorization is not memory or tenant isolation; mutually untrusted tenants require separately isolated agents/runtimes.
- Attaching to an existing interactive conversation is out of initial scope and requires a later explicit binding and concurrency design.

### Outbound identity and destinations

- Derive local agent, conversation, and caller scope from the host runtime, not model-supplied tool arguments. Continuity keys also distinguish the target's binding/identity; route retargeting or credential changes must not silently reuse another peer's context.
- Retain named routes and strict URL validation. Enforce destination policy across discovery redirects, advertised interfaces, and actual request destinations—not only the initial configured URL.
- Bind credentials to approved origins/audiences. Apply authentication appropriately to discovery and subsequent requests without forwarding secrets to an unapproved host. Credentials never enter ordinary route JSON, context state, logs, or Agent Cards.
- Trace and hop metadata are correlation/loop controls, not authentication. Propagate trusted delegation context outside the model's editable arguments. Keep remote-child failures recoverable tool results by default; outer failure is an explicit application policy.
- Push callbacks require their own destination policy, authentication, bounded delivery attempts, and redirect rules. Preserve the lab's allowlist protections, not merely its happy-path callback test.

## Package 1: `letta-a2a-client`

### Public boundary

Provide a policy-bound official SDK client path for the declared protocol surface, plus convenience invocation and two adapters. Do not hand callers an ungoverned transport that bypasses the configured destination/auth policy, or wrap every SDK method in a competing implementation.

The exact exports should be established through consumers, but must allow:

- Discovery and access to the advertised peer capabilities.
- Typed send, streaming, task inspection/listing, subscription, cancellation, and enabled push configuration using SDK contracts.
- Convenience `invoke` with text or typed content, an `AbortSignal`, timeout, context/new-context selection, and existing-task continuation.
- Both immediate messages and terminal/interrupted task results without losing original protocol data.
- Injected continuity storage, authentication/destination policy, and small structured operational callbacks.

Use asynchronous polling for the default `a2a_invoke` workflow. Keep streaming available to ordinary library consumers from the release target, rather than waiting for a later caller to request it.

### Letta adapters

- The mod and Agent SDK tool factory share invocation, continuation, error, and compact-result projection code. The SDK adapter must not require installing a process-global mod.
- Bind each tool registration to the real session and its cancellation lifecycle. Re-register connection-owned tools after reconnect and dispose of registrations on shutdown using supported SDK APIs.
- Expose a small coherent tool surface for invoking/continuing work and inspecting/canceling a known task; do not mirror the entire protocol into dozens of model tools. Exact names and grouping are proven through adapter tests.
- Compact results retain status, task/context IDs, distinct status/error text, and useful content summaries or artifact references. Structured/file content cannot disappear without an explicit indication. Bound model-facing output without truncating the underlying library result.
- Test the same behavior through both adapters, including external-tool ownership, approval enforcement, and reconnect behavior—not merely matching generated request JSON.

### Continuity and cancellation

- Keep fresh-context and explicit-context behavior unambiguous. Explicit contexts remain subject to target and ownership policy.
- Serialize calls by the actual shared remote context, including aliases or explicit overrides, not merely a route label. Serialize first-context creation for a local binding so concurrent calls do not create competing mappings.
- Distinguish concurrency-safe file writes from execution serialization. Define the supported cross-process ownership strategy before claiming shared-state concurrency; use a tested lease/lock or explicitly enforce a single owner.
- Bound discovery/authentication, queue waits, submission, polling, and cancellation cleanup. A timeout must not wait indefinitely for discovery or a queued predecessor.
- Once accepted, expose/record task and context correlation early enough for later inspection after timeout. Local cancellation means cancellation was requested; it does not prove the remote task stopped. Report confirmed versus unconfirmed cancellation and preserve readback identifiers.
- Define when context serialization releases after interruption, timeout, or unconfirmed cancellation. Returning control locally must not silently permit overlapping remote work; allow authorized same-task follow-up while interrupted, and reconcile uncertain execution before starting another turn in that context.
- Do not blindly retry an ambiguous submission. Specify request identity, duplicate handling, and recovery behavior using proven peer/SDK guarantees, not an invented exactly-once promise.

## Package 2: `letta-a2a-bridge`

### Public boundary

Extract the first version from Example 14 behind a small composition API accepting the agent binding, Letta client, SDK-compatible task store, authorized context mapping, session policy, and enabled capabilities.

- Use the official A2A request handler and `AgentExecutor` interface. The Letta Agent SDK is the supported execution boundary; use lower-level App Server handling only for a demonstrated SDK gap.
- Allow library composition separately from the convenience HTTP listener/CLI. Imports must not start servers, create agents, or install global hooks.
- Default to an explicitly selected existing agent. Creating a demonstration agent belongs in example/CLI setup, not implicit library initialization.
- Generate or validate the Agent Card against actual configured transports, content modes, security, and optional features. Do not accept contradictory capability declarations silently.
- Expose an idempotent, awaitable `close()` or async-disposal contract. Stop accepting work, resolve queued work, drain or request cancellation of active turns within a documented bound, persist outcomes, and release resources. Report incomplete cleanup rather than calling `process.exit()` inside library code.

### Execution and tool policy

- One active turn per resolved Letta conversation; different conversations can run in parallel. The single-owner rule must prevent a second bridge instance from bypassing that guarantee.
- Cancellation of a waiting task must not remove its predecessor's serialization barrier. Hold an active conversation's ownership until execution is known to have ended, including cancel, disconnect, and shutdown races.
- Stream ordered public assistant artifacts. Preserve partial output as nonfinal when work fails or is canceled; never expose reasoning or internal tool events as assistant content.
- Define explicit completed, failed, canceled, rejected, and interrupted translation outcomes. Continuation must correlate the existing A2A task with its Letta interaction, including application-approved input/authentication handling.
- Keep safe noninteractive defaults, but support legitimate existing-agent tools through explicit session policy. Example 14's dedicated tool-free guard remains its fixture policy, not the universal product rule.
- Enforce tool authorization at the supported host/controller boundary, independently of model visibility. Account for persisted agent tools; if their governance cannot be established, reject startup/use rather than silently permitting them or altering the agent's configuration.
- A background approval must have a defined deny, bounded wait, or trusted operator-mediated continuation path. A remote A2A message cannot itself approve a consequential local action merely by claiming approval.

## Durability and recovery contract

The initial durable profile has **one execution owner per binding** and a tested local durable adapter. Reuse the SDK task-store interface, including ownership and list/query semantics. Keep in-memory fixtures easy to use; do not invent a second task abstraction.

| Guarantee | Required behavior |
| --- | --- |
| Context persistence | Authorized A2A context resolves to the same Letta conversation after restart |
| Task persistence | Accepted tasks, history, artifacts, and authoritative terminal/interrupted state remain queryable |
| Execution correlation | Persist enough task/message/conversation/run identity and submission state to reconcile an interrupted controller |
| Stream reconnect | Recover an authoritative snapshot and resume supported subscriptions; do not promise replay of missed Letta SDK events |
| In-flight recovery | Determine whether work was unsent, active, finished, or unresolved before resubmitting or releasing ownership |
| Cancellation recovery | A persisted canceled flag is not proof of a stopped Letta turn; reconcile actual execution and preserve an unresolved outcome when necessary |
| Retention | Document bounded retention and cleanup of tasks, mappings, and artifacts without orphaning active work |

Define write ordering and crash windows before choosing the adapter. In particular, cover acceptance before sending, successful send before acknowledgement/correlation persistence, and completion before terminal-state persistence. Persisting a JSON snapshot alone does not solve those windows.

When execution cannot be established, retain an explicit operational recovery condition, expose a truthful protocol error/state allowed by the pinned specification, and prevent unsafe replay or overlapping turns. Do not invent a wire-level task state or claim seamless resumption. Document the operator/readback route needed to resolve it.

The Letta SDK does not replay missed events and warns against blindly retrying a successful send after disconnection. Reconcile through its supported history/status APIs. Prove behavior against the pinned runtime, including whether a turn survives loss of the bridge process or SDK-owned subprocess.

## Examples and deployment convergence

- **Example 14:** become the smallest consumer of both packages, containing configuration, agent setup, startup wiring, a direct client, and the walkthrough. Keep the restrictive text-only demo policy explicit. Remove copied executor/runtime/store/policy implementations once package-backed equivalents exist.
- **`services/bridge`:** become the full integration/deployment composition. Retain lab agent definitions, OAuth wiring, gateway routes, callback policy, Docker behavior, and evidence. Replace the outbound and inbound implementations independently only after their package seams support the existing capabilities.
- **Earlier examples:** preserve educational checkpoints. Update only when package consumption clarifies the lesson; do not falsify historical evidence or rewrite every example for uniformity.

## Development sequence

### Phase 0 — Specify contracts and expose gaps

1. Pin the protocol/SDK/runtime compatibility baseline and verify the method inventory against official sources. Record supported/deferred features and SDK-owned behavior.
2. Specify trusted ownership, conversation binding, content preservation, terminal versus interrupted states, cancellation truth, execution ownership, and recovery outcomes before freezing APIs.
3. Specify deterministic regression cases for interrupted-task polling, missing same-task continuation, partial output masking errors, mixed-content loss, and queued-cancellation serialization. In the last case, cancel waiter B behind active A, enqueue C, and prove C cannot overtake A.
4. Reproduce current defects and fix them in bounded test-first changes before or alongside extraction, separated from mechanical moves. Add each new capability's failing tests in its owning implementation phase rather than leaving the suite red across phases. Characterization tests do not bless unsafe behavior.

### Phase 1 — Extract the bridge boundary

1. Establish package-level tests for Example 14's discovery, continuation, streaming, cancellation, serialization, and tool-policy contract.
2. Extract the SDK composition with explicit ownership/session seams and awaitable lifecycle; convert Example 14's inbound path into a bridge-package consumer. Complete its client integration in Phase 2.
3. Run direct, two-turn, and nested-mod live proofs without agentgateway.
4. Keep this phase behavior-preserving apart from separately identified correctness fixes. Do not add durable storage, OAuth providers, push delivery, or multi-agent hosting during the move.

### Phase 2 — Complete the client and adapters

1. Separate policy-bound official client access from mod configuration and compact presentation. Preserve typed content and SDK contracts.
2. Complete interrupted-task continuation, standalone readback/cancellation, streaming/subscriptions, timeout coverage, and continuity ownership.
3. Add the Agent SDK tool factory and a shared small model-tool surface. Prove both adapters' lifecycle, policy, content projection, and cancellation behavior; finish Example 14's integration with the client package.
4. Preserve packaged-install and sequential cross-process continuity tests; add concurrent-process tests matching the explicitly chosen execution-ownership guarantee.

### Phase 3 — Complete protocol and policy seams

1. Close the method inventory and configuration/error tests through the official handlers, including bridge interruption/continuation and subscription behavior.
2. Implement trusted caller projection, per-operation authorization, existing-agent tool governance, and destination/credential policy with direct-endpoint tests.
3. Port delegation controls and push store/sender policy through SDK extension points. Preserve callback allowlists, redirect restrictions, bounded retries, and correlation events.
4. Prove OAuth, hop propagation, push, and caller-isolation compatibility before attempting service convergence. Keep provider credentials, gateway URLs, JWT fixtures, and Docker specifics outside the packages.

### Phase 4 — Converge the mature service

1. Replace the service client with package primitives while retaining deployment-owned OAuth configuration and trusted delegation context.
2. Replace executor/runtime primitives one seam at a time; retain multi-agent hosting as composition of independent bindings.
3. Keep protocol, streaming, cancellation, push, OAuth, and provider-backed tests green after each replacement. Remove duplicate implementations only after equivalent package-backed evidence exists.

### Phase 5 — Prove durable recovery

1. Derive the adapter and persistence ordering from crash-window tests; retain SDK task-store semantics and explicit context ownership.
2. Test restart while queued/running/interrupted/completed, uncertain submission, lost completion persistence, duplicate delivery, stream reconnect, and cancellation after restart.
3. Prove that recovery does not duplicate consequential work, falsely report cancellation, or release a conversation while an earlier turn may still be active. Where certainty is unavailable, prove safe unresolved behavior rather than automatic replay.
4. Verify retention, clean shutdown, and refusal of unsupported concurrent owners. Document recovery limits and operator procedures.

### Phase 6 — Prepare public releases

1. Finalize package names/scope, exports, licenses, changelogs, and semantic-versioning policy.
2. Pin and test supported A2A SDK, Letta Agent SDK, Letta Code, Node.js, Bun, and OS combinations. Verify supported local and remote/Cloud SDK configurations; label untested backends explicitly rather than claiming universal agent support.
3. Preserve the self-contained mod bundle; build reproducibly and fail CI on stale committed output. Keep library imports independent of mod installation and Bun runtime APIs.
4. Test packed artifacts in clean temporary homes and ordinary Node.js consumers, including shutdown and no import-time side effects.
5. With separate publication approval, publish prereleases and verify registry installation. Stable release requires the acceptance gates below, not only successful repository-local demos.

## Verification and acceptance

Use deterministic agents and controlled SDK seams for protocol assertions. Use provider-backed tests for real integration, existing-agent policy, tool provenance, and conversation continuity without asserting exact natural-language wording.

Keep the test matrix in three dimensions rather than confusing deployment with protocol capability:

1. **Protocol:** every required inventory row, terminal/interrupted lifecycle, content preservation, invalid inputs, and enabled optional features.
2. **Integration:** client library, Letta Code mod, SDK tools, bridge, nested bridge-to-client delegation, and independent `a2acli`/Python interoperability.
3. **Deployment:** direct local, directly authenticated, gateway-backed, and durable single-owner profiles on declared platforms/backends.

Exercise meaningful combinations, not a redundant Cartesian product. The following gates are mandatory:

- [ ] Both packages expose the declared A2A 1.0 profile using official SDK primitives; capability declarations are truthful.
- [ ] New-context, continued-context, and same-task follow-up work, including interrupted tasks and invalid/terminal-task rejection.
- [ ] Typed content and artifact boundaries survive the client; compact projections preserve separate failure/interruption information; unsupported bridge content fails explicitly.
- [ ] Blocking/immediate sends, task listing/history limits, streaming/subscriptions, and push configuration/delivery pass the method inventory tests.
- [ ] Cross-principal get/list/continue/cancel/subscribe/push access is denied. Anonymous trust, shared agent memory, and isolated-tenant requirements are documented.
- [ ] Malicious advertised endpoints, redirects, credential forwarding, callback destinations, and forged caller/hop metadata cannot bypass policy.
- [ ] Both Letta adapters derive scope from the real runtime, recover registrations correctly, and preserve governing approvals. Existing-agent tests cover legitimate allowed tools and denied consequential actions.
- [ ] Same-conversation ordering holds across queued cancellation, timeout, shutdown, and supported process configurations; independent conversations run concurrently.
- [ ] Durable recovery covers all documented crash windows, ambiguous outcomes, and cancellation truth without blind resubmission or unsafe ownership release.
- [ ] Awaitable shutdown is idempotent and bounded, with incomplete cleanup reported accurately.
- [ ] Example 14 and the mature bridge service consume the packages without duplicate core implementations or loss of existing integration evidence.
- [ ] Packed/registry artifacts pass declared platform/backend gates; documentation separates current support, deferred capabilities, deployment policy, and historical examples.

## Explicit non-goals

- Another A2A implementation, distributed-agent orchestrator, or production identity provider/policy database.
- Mandatory agentgateway, implicit agent creation, hidden global registries, or automatic injection into an active terminal conversation.
- Exactly-once execution promises, seamless in-flight restart, or multi-process execution ownership without evidence and an explicit supported contract.
- Treating Agent Cards, context IDs, model-facing tool visibility, hop counts, or shared-agent conversations as authorization/tenant isolation.
- Rewriting every historical example, adding demonstration agents merely for orchestration, or adding packages/frameworks before a concrete boundary needs them.
- Silently broadening the release's declared text-execution and transport profile; additional profiles require explicit implementation and conformance tests.

## Source guidance

- [A2A specification](https://a2a-protocol.org/latest/specification/) — select and record the 1.0 revision used for conformance; do not let a moving latest page silently change the release contract.
- [A2A JavaScript SDK](https://github.com/a2aproject/a2a-js) — pin source/version for canonical types, handlers, task stores, transports, and capability/error behavior.
- [Letta SDK sessions, turns, and durability](https://docs.letta.com/agent-sdk/sessions/index.md) — conversation identity, cancellation, missed events, and ambiguous-send limitations.
- [Letta SDK permissions](https://docs.letta.com/agent-sdk/permissions/index.md) — session approvals and recovery.
- [App Server external tools](https://docs.letta.com/platform/app-server/external-tools/index.md) — connection-owned tools, scope, and reconnect registration.
- [App Server integration patterns](https://docs.letta.com/platform/app-server/integration-patterns/index.md) — controller authorization, durable state, and per-conversation concurrency.
- [Letta Code mods](https://docs.letta.com/configuration/mods/index.md) — packaged mod installation, permissions, and lifecycle.
