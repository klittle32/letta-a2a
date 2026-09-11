# Letta A2A package contracts

Implementation baseline for [the package plan](LETTA_A2A_PACKAGES_PLAN.md). This records decisions and source-level findings, not a claim that all release gates pass.

## Compatibility baseline

| Surface | Pinned baseline | Notes |
| --- | --- | --- |
| Protocol | A2A `v1.0.0`, commit `173695755607e884aa9acf8ce4feed90e32727a1` | JSON-RPC + SSE; later protocol revisions require an explicit compatibility review |
| Package A2A SDK | `@a2a-js/sdk` `1.1.0`, upstream tag commit `eeffd69c983b6501cac912c693b69c034977455c` | Already pinned in the client package and Example 14 |
| Letta Agent SDK | `@letta-ai/letta-agent-sdk` `0.8.3` | Already pinned in Example 14; its local runtime dependency is Letta Code `0.31.7` |
| Existing Docker lab | A2A JS SDK `1.0.1`; Letta Code `0.30.25` | Leave unchanged during initial extraction; convergence must prove compatibility rather than silently upgrading the lab |
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
- Specification §3.4.2: `taskId` alone continues a task and implies its context; `contextId` alone starts a new task in that context. A supplied conflicting pair must be rejected. The Phase 2 client/tool supports this; the initial bridge still rejects existing-task execution.
- Specification §§3.1.2, 3.1.6: streaming begins with a task snapshot or a single immediate message. Subscription returns the current task first and rejects terminal tasks. Interrupted tasks are not terminal.
- Specification §3.2.2: `historyLength: 0` requests no history; a positive limit cannot be exceeded. The SDK handler implements this—do not duplicate it in the executor.
- Specification §3.3.2: unsupported input media should yield the protocol's content-type error. Initial strict example validation prevents silent partial execution; moving that validation to the package request boundary is needed for full wire-error conformance.
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
- Input/auth interruptions return task and context identity to the caller. Same-task follow-up is implemented by the Phase 2 client; bridge support remains Phase 3, not implied merely by stopping polling.
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
| Lab client polls interrupted tasks until timeout | Phase 4 convergence | Keep explicit as a current lab limitation; replace through the tested package rather than grow another result API |
| Lossless typed client results, same-task follow-up, discovery timeout | Phase 2 | Typed core and shared adapters; see Phase 2 evidence for exercised cases |
| Full task/list/subscription/ownership and media error matrix | Phase 3 | Test SDK composition and preserve protocol errors, not duplicate handlers |
| Restart, ambiguous cancellation, persistence ordering | Phase 5 | Fault-injection tests; safe unresolved recovery is acceptable where certainty is unavailable |

This contract intentionally precedes a stable public package API. It fixes semantics and ownership while leaving names and small composition details to tested consumers.

## Phase 2 client ownership decisions

- The named-route facade journals/serializes convenience invocations. Its `connect` method returns the same-origin/redirect-restricted official SDK client; direct SDK method lifetimes and execution coordination remain application-owned.
- File-backed users sharing a state path lock both first-context bindings and resolved remote contexts across processes. This does not coordinate separate state paths, arbitrary SDK consumers, or remote processes that ignore the protocol. Orphan locks fail closed; no age-based lease stealing.
- A persisted submission-unknown flag is separate from accepted working/interrupted task state. It applies to new tasks and continuations. An unchanged interrupted snapshot cannot authorize replay. Automatic correlated-history recovery is not implemented; manual reconciliation preserves the journal.
- All service invocation stages share one absolute monotonic deadline with core cleanup. Caller return may precede noncooperative persistence settlement, but callbacks are serialized and ownership is retained until actual settlement.
- `drain(ownerSignal)` reports actual local operation/persistence completion, not remote cancellation certainty. SDK tool-group disposal uses it and rejects incomplete cleanup within its bound.
- SDK 0.8.3 calls external `execute(id, input)` without a cancellation signal and does not serialize tool approval flags. The adapter requires an explicit owner signal; host session policy owns approvals. Bridge session-option factories expose a ready-conversation getter and owned cleanup hook so tools remain session-local.
- Fresh SDK sessions receive fresh tool registrations. Transparent continuation across a lost SDK stream, event replay, and automatic mid-turn reconnect are not claimed.
