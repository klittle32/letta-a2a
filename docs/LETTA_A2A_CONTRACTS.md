# Letta A2A package contracts

Implementation baseline for [the package plan](LETTA_A2A_PACKAGES_PLAN.md). This records decisions and source-level findings, not a claim that all release gates pass.

## Compatibility baseline

| Surface | Pinned baseline | Notes |
| --- | --- | --- |
| Protocol | A2A `v1.0.0`, commit `173695755607e884aa9acf8ce4feed90e32727a1` | JSON-RPC + SSE; later protocol revisions require an explicit compatibility review |
| Package A2A SDK | `@a2a-js/sdk` `1.1.0`, upstream tag commit `eeffd69c983b6501cac912c693b69c034977455c` | Already pinned in the client package and Example 14 |
| Letta Agent SDK | `@letta-ai/letta-agent-sdk` `0.8.3` | Already pinned in Example 14; its local runtime dependency is Letta Code `0.31.7` |
| Converged Docker lab | A2A JS SDK `1.1.0`; Letta Agent SDK `0.8.3`; App Servers `0.30.25` | Phase 4 proved remote compatibility without upgrading the App Servers; root consumes both packages |
| Initial local validation | macOS, Node.js `24.19.0`, Bun `1.4.2` | Package engine floor is not evidence of testing every supported version or OS |

Frozen lockfiles remain authoritative for transitive dependencies. New package exports must run under ordinary Node.js, not require Bun at runtime. Broader Node/OS/backend proof belongs to release preparation.

Sources: [pinned specification](https://github.com/a2aproject/A2A/blob/173695755607e884aa9acf8ce4feed90e32727a1/docs/specification.md), [pinned protocol definitions](https://github.com/a2aproject/A2A/blob/173695755607e884aa9acf8ce4feed90e32727a1/specification/a2a.proto), [pinned A2A SDK source](https://github.com/a2aproject/a2a-js/tree/eeffd69c983b6501cac912c693b69c034977455c).

## Method ownership

The wire names below are verified against the pinned protocol. Reuse the SDK's implementation; package tests exercise its composition with Letta.

| Wire method | SDK client method | Package obligation |
| --- | --- | --- |
| `SendMessage` | `sendMessage` | Preserve `Message` or `Task`; default convenience invocation polls; interrupted tasks return control |
| `SendStreamingMessage` | `sendMessageStream` | Preserve typed task/status/artifact events and immediate-message streams |
| `GetTask` | `getTask` | Preserve owner-scoped lookup and history limits |
| `ListTasks` | `listTasks` | Preserve owner-scoped filtering, pagination, and artifact options |
| `CancelTask` | `cancelTask` | Correlate protocol cancellation with actual execution; request is not confirmation |
| `SubscribeToTask` | `resubscribeTask` | Initial current-task snapshot, updates, terminal-state rejection |
| `CreateTaskPushNotificationConfig` | `createTaskPushNotificationConfig` | Required in the push-enabled profile; callback destination/credential policy remains mandatory |
| `GetTaskPushNotificationConfig` | `getTaskPushNotificationConfig` | Authorized configuration lookup |
| `ListTaskPushNotificationConfigs` | `listTaskPushNotificationConfig` | Preserve the SDK's singular client method spelling; do not invent another protocol abstraction |
| `DeleteTaskPushNotificationConfig` | `deleteTaskPushNotificationConfig` | Authorized configuration deletion |
| `GetExtendedAgentCard` | `getAgentCard` conditionally calls the transport's `getExtendedAgentCard` | Disabled on the initial bridge; the SDK client owns capability-aware fetching |

Agent Card discovery is separate from the RPC inventory. JSON-RPC/SSE are the package release target; REST/gRPC, signatures, and arbitrary extensions remain explicitly deferred. The initial bridge executes text only; the Phase 2 client boundary preserves all SDK part types.

### Normative semantics to retain

- Specification §§3.1, 3.2.2, 3.4: terminal states are completed/failed/canceled/rejected; input-required/auth-required are interrupted. Blocking sends wait for either category. A stopped convenience call does not imply a terminal remote task.
- Specification §3.4.2: `taskId` alone continues a task and implies its context; `contextId` alone starts a new task in that context. A supplied conflicting pair must be rejected. The Phase 2 client/tool supports this; Phase 3 bridge continuation requires a safely settled input/auth interruption.
- Specification §§3.1.2, 3.1.6: streaming begins with a task snapshot or a single immediate message. Subscription returns the current task first and rejects terminal tasks. Interrupted tasks are not terminal.
- Specification §3.2.2: `historyLength: 0` requests no history; a positive limit cannot be exceeded. The SDK handler implements this—do not duplicate it in the executor.
- Specification §3.3.2: unsupported input media yields the protocol's content-type error at the Phase 3 package request boundary, before execution. Mixed input is not partially executed.
- Specification §7.6: in-task authentication is not the same as transport authorization failure. Any bridge interruption signal must come from an explicit trusted application/session outcome, not parsing assistant prose.

## Identity and state ownership

1. **Inbound binding:** one explicitly selected Letta agent per bridge instance. An authorized A2A context maps to a dedicated Letta conversation, not the user's open terminal conversation.
2. **Owner scope:** trusted issuer/principal or an explicit sharing domain, plus tenant where applicable and the bridge binding. Use unambiguous structured keys. Scope must reach both context mapping and SDK task/push-store calls.
3. **Anonymous profile:** loopback, one shared trust domain. It is not evidence of caller isolation. Agent memory remains shared across its conversations; mutually untrusted tenants require isolated agents/runtimes.
4. **Outbound continuity:** host-derived local agent/conversation scope plus target binding/identity. Model arguments cannot supply caller identity, credential scope, or trusted delegation metadata.
5. **Execution:** one owning bridge process per binding initially. Within it, serialize by resolved conversation; independent contexts may run concurrently. Cross-process file-write locking does not prove execution serialization.
6. **Credentials:** validate discovery, redirects, advertised endpoints, and actual destinations. Attach credentials only within their approved origin/audience scope. Token refresh must not change the logical owner; a different credential identity must not inherit continuity accidentally.

In SDK `1.1.0`, `ServerCallContext` exposes `user`, `tenant`, and trusted application `state`; the default task store uses an `OwnerResolver`. Its task ownership is not a substitute for the bridge's separately authorized conversation mapping. Preserve those SDK seams rather than replacing them with unscoped storage.

## Output and interruption contract

- The library owns typed messages, tasks, and distinct artifacts; the model adapter owns a bounded readable projection. Do not flatten the only copy of the protocol result.
- Phase 2 returns the original SDK `Message | Task`. Only the model adapter projects bounded artifact/text/part summaries, with separate status text and explicit omission markers.
- The initial text-only bridge rejects a mixed text/data/file message as a whole before invoking Letta. It must not act on the text while silently discarding the attachment.
- Input/auth interruptions return task and context identity to the caller. Same-task follow-up is implemented by the Phase 2 client and Phase 3 bridge. The latter requires an explicit, settled trusted runner outcome; stopping polling alone is insufficient.
- Raw exception text is not a public error contract. Stable protocol failures are separate from public assistant artifacts; no hidden reasoning or secrets may be exposed.

## Cancellation and crash windows

Maintain separate facts: cancellation requested, remote acknowledgment, and underlying execution stopped. A failed or unavailable acknowledgment does not authorize another turn in the same unresolved context.

| Window | Required next action |
| --- | --- |
| Task accepted, message not sent | Recover the durable submission record before deciding whether to send |
| Send may have succeeded, acknowledgment lost | Inspect supported runtime/history state; do not blindly retry |
| Turn active when controller disconnects | Reconcile actual execution; keep ownership unresolved until safe |
| Turn finished, terminal record not persisted | Recover correlated output/status if supported; otherwise expose unresolved recovery rather than repeat work |
| Cancellation requested during restart | Reconcile the underlying turn before claiming cancellation or releasing the conversation |
| Stream disconnected | Read an authoritative task snapshot; do not promise replay of missed Letta SDK events |

The durable adapter must implement the official task-store contract and retain correlation/ownership metadata. Its persistence mechanism is chosen in Phase 5 from these tests, not by assuming JSON snapshots provide exactly-once execution.

**SDK hazard to cover:** in A2A JS SDK `1.1.0`, `DefaultRequestHandler.cancelTask()` marks a stored task canceled directly when its in-memory event bus is missing, without calling the executor. Do not expose that fallback as proof of stopping a surviving Letta turn after restart. The durable profile needs a reconciliation guard at a supported handler boundary.

Letta's SDK documentation states that missed events are not replayed and successful sends must not be blindly retried after disconnection: [sessions and durability](https://docs.letta.com/agent-sdk/sessions/index.md). Prove subprocess survival and recovery behavior against the pinned local runtime, not a presumed remote execution model.

## Regression ownership and implementation status

| Case | Owning slice | Evidence / remaining work |
| --- | --- | --- |
| A active; queued B canceled; C must not overtake A | Phase 0 | Deterministic runner regression, with cancellation and independent-context controls |
| Partial artifact output masks failure/input/auth message | Phase 0 | Packaged-client regression; retain separate `statusMessage` |
| Mixed text plus data/raw/URL content silently partially executes | Phase 0 | Strict text-extraction tests; package-level rejection/no-turn tests during extraction |
| Input/auth interruptions classified as terminal | Phase 0 terminology, Phase 2 continuation | Stop polling without remote cancellation; client same-task followup is explicit |
| Lab client previously polled interrupted tasks until timeout | Resolved in Phase 4 | Service uses the package invoker and returns input/auth status plus continuation identity; no duplicate polling loop |
| Lossless typed client results, same-task follow-up, discovery timeout | Phase 2 | Typed core and shared adapters; see Phase 2 evidence for exercised cases |
| Task/list/subscription/ownership and media error matrix | Phase 3 | Package regressions and root direct-HTTP/OAuth fixture; see Phase 3 evidence for limits |
| Restart, ambiguous cancellation, persistence ordering | Phase 5 | Fault-injection tests; safe unresolved recovery is acceptable where certainty is unavailable |

This contract intentionally precedes a stable public package API. It fixes semantics and ownership while leaving names and small composition details to tested consumers.

## Phase 2 client ownership decisions

- The named-route facade journals/serializes convenience invocations. Its `connect` method returns the destination-policy/redirect-restricted official SDK client (same-origin by default); direct SDK method lifetimes and execution coordination remain application-owned.
- File-backed users sharing a state path lock both first-context bindings and resolved remote contexts across processes. This does not coordinate separate state paths, arbitrary SDK consumers, or remote processes that ignore the protocol. Orphan locks fail closed; no age-based lease stealing.
- A persisted submission-unknown flag is separate from accepted working/interrupted task state. It applies to new tasks and continuations. An unchanged interrupted snapshot cannot authorize replay. Automatic correlated-history recovery is not implemented; manual reconciliation preserves the journal.
- All service invocation stages share one absolute monotonic deadline with core cleanup. Caller return may precede noncooperative persistence settlement, but callbacks are serialized and ownership is retained until actual settlement.
- `drain(ownerSignal)` reports actual local operation/persistence completion, not remote cancellation certainty. SDK tool-group disposal uses it and rejects incomplete cleanup within its bound.
- SDK 0.8.3 calls external `execute(id, input)` without a cancellation signal and does not serialize tool approval flags. The adapter requires an explicit owner signal; host session policy owns approvals. Bridge session-option factories expose a ready-conversation getter and owned cleanup hook so tools remain session-local.
- Fresh SDK sessions receive fresh tool registrations. Transparent continuation across a lost SDK stream, event replay, and automatic mid-turn reconnect are not claimed.

## Phase 3 policy and protocol decisions

- Authenticated callers are projected from verified transport context into immutable issuer/subject/tenant identity. Binding and identity scope official SDK task/push storage and dedicated Letta conversations; shared agent memory is **not** a tenant isolation boundary.
- Every operation is authorized. Current credential scopes remain request-local; `authorize` receives the original verified context. An owner-keyed scope cache permitted concurrent low-scope/high-scope tokens to mix permissions and was removed after independent reproduction.
- Owner-scoped task lookup precedes shared cancellation/submission reservations. Foreign callers cannot briefly reserve an owner's cancellation or distinguish active foreign task IDs through continuation errors.
- Existing-agent tool inventory is checked by ID inside the turn serialization lock. Session-local approvals and persisted-tool governance remain separate. This does not atomically exclude external administrative tool changes.
- Client destination origins and credential origins are separate host policy. Credential providers confirm stable identity/audience, protected headers cannot be supplied by model/per-call overrides, refresh does not change continuity ownership, and ambiguous sends are not retried. Custom transports/stores remain trusted adapters.
- Explicit delegation and bounded hop conventions are helper policy, not protocol fields. Applications project the verified decision and enforce it in outbound tool permissions. The mature service's legacy metadata/deployment configuration is not silently changed.
- Push uses official stores/senders and V1 serialization with exact host-approved URL/Bearer bindings, redacted protocol results, bounded retries, ordered delivery, and awaited/bounded owned cleanup. `GetTask` remains authoritative.
- Settled input/auth interruptions finish the official event bus without changing wire state. Disconnected stream consumers continue draining the official handler for persistence. Restart without a live owner still requires reconciliation, not the SDK missing-bus cancellation fallback.
- Extended cards remain explicitly unadvertised on the bridge; the client supports capable peers. Text is the only executable bridge media profile. These tests do not establish full release, durable recovery, service convergence, or broad platform coverage.

Evidence: [Phase 3 checkpoint](evidence/2026-09-11-a2a-packages-phase-3.md).

## Phase 4 service convergence

- The mature service and Example 14 consume the packages. The service retains application bootstrap, cards, OAuth/JWKS, lab metadata translation, and idle mapping storage—not another executor, push sender, polling implementation, or raw App Server turn loop.
- Authenticated bindings independently verify incoming JWTs and enforce owner isolation. Required claims, scopes, and singular-role policy match the gateway. Tokens are forwarded only to bridge routes that need independent verification; reference/ADK routes explicitly remove Authorization.
- Conversation mapping adapters run inside the SDK runner's serialization boundary and persist ready IDs before submission. Old unowned service mappings remain untouched but are not automatically adopted. This is idle continuity, not crash recovery.
- Session tool policy is strict, connection-owned, and checked against persisted inventory. Remote `createAgent` receives only supported creation fields. SDK 0.8.3 and Code 0.30.25 interoperability passed the real provider-backed matrix.
- Detailed commands, regressions, limits, and review: [Phase 4 evidence](evidence/2026-09-11-a2a-packages-phase-4.md). Phase 3's historical statement that its tests alone did not establish convergence still applies to that checkpoint; Phase 4 supplies the later evidence.

## Phase 5 single-owner recovery

- `DurableBinding` provides a local transactional adapter around the official SDK TaskStore/ResultManager semantics. A separate SQLite exclusive transaction holds process ownership; state commits remain durable. Same-directory concurrent owners reject; no timed lock stealing is used.
- Message reservations, acceptance, pre-send intent/correlation, observations, stopped evidence, and final publication are ordered explicitly. Recovery repairs already-proven snapshots or preserves unresolved fences, never sends input automatically. Task failure is not proof that remote execution stopped.
- **Cancellation correction:** source inspection and live observation of Code 0.30.25 show that SDK interruption/idle/abort acknowledgment can precede actual backend cancellation. Sent SDK interruption now quarantines rather than certifying cancellation. Historical Phase 4 outer-cancellation assertions were corrected, not silently treated as stronger evidence than they were.
- Duplicate tombstones survive retention; unresolved work and referenced mappings are not pruned. Bounded admission cannot strand valid records during recovery bookkeeping or SDK representation expansion. Shutdown stops admission and rechecks execution/persistence after facade drain before releasing the owner.
- Optional service environment: `BRIDGE_DURABLE_DIRECTORY`; default volatile behavior remains available. Legacy mappings are not migrated. Push registrations remain process-local. Node/macOS fixtures, Linux durable service integration, and real SDK readback observations are separately identified in [Phase 5 evidence](evidence/2026-09-11-a2a-packages-phase-5.md).
- [Operator/readback procedures and limits](DURABLE_RECOVERY.md); [ordering design](PHASE_5_RECOVERY_DESIGN.md). Phase 6 broad release certification and publication are not implied.

## Phase 6 release preparation

- Both established package names are MIT-licensed `0.1.0-alpha.1` candidates, still private with rejecting publication hooks. Root and package licenses/changelogs and the bundled A2A SDK's Apache-2.0 notice are distributed. Bridge Express declarations now have a production type dependency.
- The tracked standalone client bundle matches two clean Bun 1.4.2 builds byte-for-byte. The gate runs before ordinary builds; no bundle regeneration or production TypeScript change was needed for this phase.
- Clean npm tarball consumers use temporary homes and allowlisted environments, disabled installation hooks, and ordinary Node 24.19.0. The gate exercises core import without the optional SDK, installed exports/mod activation/disposal, approval flags, loopback lifecycle, and durable reopen/deduplication. Fake-host/runner evidence is not a real Letta backend test.
- Provider-free CI is configured for macOS/Linux, not yet executed remotely. Locally executed macOS arm64 and Linux arm64 gates and the upstream `skipLibCheck` limitation are recorded in [Phase 6 evidence](evidence/2026-09-11-a2a-packages-phase-6.md). [Support policy](RELEASING.md) separates SDK transport, Letta storage backend, OS/runtime, and untested configurations. Registry installation remains unproven until separately approved publication.
