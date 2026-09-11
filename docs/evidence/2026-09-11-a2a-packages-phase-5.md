# Phase 5 — single-owner durable recovery

2026-09-11 implementation checkpoint. Not a registry release or production deployment.

Phase 4 was committed as `bdb5f63d5e6dafe61fa305ac3d8ca2c9d1fe5019`, fast-forwarded to `main`, pushed, and its worktree/branch removed. Phase 5 is **uncommitted** in `.letta/worktrees/a2a-phase-5`, branch `letta/a2a-phase-5-4b91f40a`. The next phase is release preparation, not automatic publication.

## Scope and design

See [ordering](../PHASE_5_RECOVERY_DESIGN.md) and [operator guide](../DURABLE_RECOVERY.md). The implementation adds native SQLite storage with a lifetime local owner lock, official SDK task serialization/query/reduction, durable message/attempt/mapping records, awaited SDK lifecycle hooks, idempotent publication repair, exact-evidence reconciliation, and retention/admission limits. The service opts in through `BRIDGE_DURABLE_DIRECTORY`; no legacy migration is performed.

Recovery never automatically resubmits. It distinguishes provably unsent work, observed stopped success, pending publication, and unknown execution. Unknown work remains fenced even if the A2A request has failed. Normal SDK success after cleanup and explicitly settled custom-runner outcomes are distinguished from ambiguous interruption/disconnection.

## Executed gates

| Gate | Result |
|---|---|
| Final root Bun suite | **321 passed**, 1,731 assertions, 45 files |
| Root/package source and test TypeScript gates | Passed |
| Root and both public package builds; Example 14 dependency refresh/typecheck | Passed |
| Python reference / ADK suites | **43 / 17 passed**; upstream ADK warnings remain |
| Actual subprocess SIGKILL/reopen matrix | **10 cases passed** |
| Clean packed consumer with actual installed dependencies, ordinary Node 24.19.0 | Passed |
| Live SDK 0.8.3 → Code 0.30.25 fault/readback probe | Passed within the observations below |
| Full provider-backed Docker matrix with durable service enabled | Passed using `openai/gpt-4.1-nano` |
| Independent strict review and reproduced findings | All reported blockers/nonblocking findings resolved; final reviewer reran all 13 durable-binding tests |
| Whitespace and isolated-container cleanup | Passed |

The SIGKILL fixtures exercise acceptance before dispatch, pre-send intent, send-return observation, result before stopped evidence, stopped before publication, publication before final task save, completed tasks, trusted input interruption, **a genuinely queued same-context turn behind active work**, and cancellation after restart. External append-only fake-send counters survive controller death: ambiguous recovery/re-delivery never increases them. Repeated recovery preserves snapshot/history/artifact identity, duplicate rejection, quarantine, subscription behavior, and retention protections.

Additional tests cover SQLite owner/binding/corruption refusal, SDK query parity, alias mapping rejection, write ordering/failure, disposal, active-run correlation, exact operator evidence (including binding-wide stop when conversation correlation is absent), bounded journal/task admission, and late-request shutdown races.

## Real remote observations—not invented certainty

An isolated Code 0.30.25 container used SDK 0.8.3 and a fresh Nano-backed agent. Each case used a separate conversation. Normal completion, explicit abort, abrupt controller exit during streaming, and injected WebSocket loss were followed by **fresh management-only processes** calling `conversations.listMessages`, without opening a session or sending more input.

- Each readback contained exactly one user message with its saved caller OTID.
- Normal completion reported success/end-turn and an observed local run ID.
- Explicit abort returned, then another buffered assistant chunk arrived, followed by an interrupted result/idle projection.
- Wire loss produced an error and failed `stream_closed` result.
- User-message history retained caller OTIDs; assistant-stream OTIDs differed. History projections did not expose run IDs in this probe.

Pinned image digest: `ghcr.io/letta-ai/letta-code@sha256:e74c4042758ae294f81edfbab6c42586de23e10cb87bcbe351b87d98c3803dea`.

These facts do **not** establish backend settlement, whole-turn cancellation, or survival across App Server restart. Pinned Code source (`v0.30.25`, `c0956ed3263da7f781a958ce35ff3042ef97adfa`) corroborates asynchronous cancellation in `src/websocket/listener/control-inputs.ts`, `message-router.ts`, and connection/turn lifecycle code. SDK remote turn coordination can synthesize interruption/failure. The safe profile therefore retains uncertainty.

The complete durable Docker matrix separately verified Agent Card routing, auth/owner policy, push, ordered streaming, async tasks, continuation/failure, Letta A → Python and Python → Letta A delegation. Its cancellation assertion now requires an **unresolved outer Letta outcome plus confirmed independent-child cancellation**, rather than mislabeling an SDK interruption as stopped. Tested credentials were absent from service logs. Test stacks and the probe container were removed; no ordinary lab containers were targeted.

## Review findings and fixes

- Recovery snapshot duplication and per-chunk SDK expansion could exceed an admitted record's budget and brick reopen. Publications now live separately; observation admission checks the actual SDK-derived representation; recovery preserves admitted data and mandatory bookkeeping. Boundary regressions include a 4096-byte/2200-character output, thousands of tiny chunks, and a near-budget 370-character message identity.
- Dispatch without saved conversation correlation had no usable resolution path. Detached operator resolution now requires exact attempt plus **binding-wide independently verified stop evidence** for that case, not an unqualified fence clear.
- Concurrent task admission could exceed the cap. Capacity is rechecked inside atomic insertion after SDK reduction.
- Pending authorization and post-reservation microtasks could invalidate an early empty-executor close snapshot. Close tracks facade requests/stream drains, stops admission, rejects late execution, and performs a fresh bounded final drain before owner release.

## Reproduction and artifact provenance

Use the README package-first frozen install/build commands, then `bun test`, root/package checks/builds, and both frozen uv/pytest suites. The live command is:

```sh
BRIDGE_DURABLE_DIRECTORY=/data/durable \
LETTA_TEST_MODEL=openai/gpt-4.1-nano \
node scripts/integration-a2a.mjs
```

It requires `OPENAI_API_KEY`, managed mode, free ports, and a unique project. As in Phase 4, this session unset inherited ordinary-lab and `A2A_INTEGRATION_*` project/port overrides plus `A2A_SKIP_LIVE_LETTA`. The script owns cleanup. Provider-free SIGKILL tests are committed under `packages/letta-a2a-bridge/tests/durable-crash.test.ts` and its fixture.

Ignored local artifacts: `.letta/checks/phase5-sdk-recovery/` contains the remote probe; its final successful observations are lines 86–178 of `observations.jsonl` (earlier failed/cleaned attempts remain). `.letta/checks/phase5-packed-proof/proof.log` records tarball installation and Node consumer checks: one fake session creation, one resume, two sends, two disposals, no import-time network/subprocess activity. These scratch artifacts are not permanent release evidence; this checkpoint records their executed scope without credentials.

## Limits

No exactly-once remote work, automatic in-flight replay, definitive general SDK stop query, replay of missed events, distributed ownership, network-filesystem locking, hostile-local-writer defense, or broad OS/backend certification. An A2A `FAILED` outcome does not release uncertain remote execution. Operator evidence is an explicit privileged attestation, not an automatic proof. Shared agent memory remains a shared trust domain. Push registrations and the Python peer remain volatile. Phase 6 still owns release/package matrix/registry work and requires separate publication approval.
