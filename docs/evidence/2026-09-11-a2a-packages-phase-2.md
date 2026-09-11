# A2A packages — Phase 2 client and adapters

Date: 2026-09-11 UTC. Continues [Phase 0/1](2026-09-11-a2a-packages-phase-0-1.md) under the [approved plan](../LETTA_A2A_PACKAGES_PLAN.md).

This is an **uncommitted implementation checkpoint**, not a package release, deployment, or complete conformance claim. `main`/`origin/main` remain at the delivered plan commit `d6bfda6`; work is in `letta/a2a-packages-implementation-4dd26ed0`.

## Implemented

- Public Node ESM/declaration exports for `letta-a2a-client`, plus a separate optional `/agent-sdk` entry and the bundled mod.
- Original official SDK `Message | Task` results, typed parts and distinct artifacts. Convenience invocation supports interrupted-task followup, early ownership callbacks, cancellation/readback, and a deadline shared with queue/setup time. No automatic submission retry.
- Policy-bound official SDK access through `connect`, plus lower-level bounded streaming/subscription helpers. Same-origin discovery/advertisement/transport restrictions and redirect rejection; no new protocol implementation.
- Durable controller journals and actual-context locking. Same-URL aliases share bindings; route changes do not inherit old endpoint continuity. Cooperating file-store processes coordinate key ownership separately from atomic file-write locking. Orphan locks fail closed rather than being stolen by elapsed time.
- Shared `a2a_invoke` and `a2a_task` tools, trusted host scope, strict arguments, bounded valid-JSON projection, artifact/part summaries, explicit filtering, and preserved status/error/readback information.
- Session-owned SDK tool groups with explicit owner cancellation and bounded disposal. `drain(signal)` waits for actual local operation/persistence completion, not merely the model-facing promise. Remote cancellation certainty remains a separate fact.
- Bridge session-option factories expose the ready conversation identity and an owned cleanup hook. Example 14 consumes both packages; SDK tools are the default, with explicit mod mode available.
- Source **and test** typechecking for both packages and Example 14. Enabling the example's test gate exposed an old raw-part fixture using `Uint8Array` instead of the pinned Node SDK's `Buffer`; corrected the fixture without weakening the gate.

## Tests-first and review findings

New tests failed before their implementation for library composition, scoped tool setup/cleanup, adapter configuration, and provider-compatible schemas. Independent review reproduced five substantive lifecycle defects; each received a regression and was verified resolved:

| Defect | Corrected behavior |
| --- | --- |
| Foreign task/context identity reached callbacks and cancellation | Validate before ownership mutation/delivery, pin learned identity, check subscription IDs, discard foreign cancellation readback |
| A timed-out persistence callback wrote after ownership release | Serialize and track started callbacks; recovery queues behind them and locks remain held until actual settlement |
| Lost continuation acknowledgment permitted another send from an old interrupted snapshot | Persist `submissionUnknown` for every send, including continuations; unchanged task status cannot clear quarantine |
| Independently started client timeout extended cleanup past the service budget | One absolute monotonic deadline caps work and independent cleanup, including previous queue/setup time |
| Tool-group close mistook a returned cancellation error for completed local cleanup | Track exact owner/call signals and await service drain within the close bound; incomplete disposal rejects and the bridge quarantines the sent turn |

The follow-up reviewer reran the original probes and reported all five resolved, with 97 focused tests passing at that point. The final full count below also includes subsequent schema and recovery-guidance regressions.

The first provider-backed run found an additional integration defect that passing unit fixtures did not establish: OpenAI rejected the tool schema's root-level `not`, even on a turn that did not use the tool. Removed that provider-incompatible keyword, retained the same cross-field validation in runtime argument parsing, added a deterministic schema regression, then reran the live proof successfully. Trusted legacy/unknown-submission guidance was also changed to a typed operational error so the shared projection does not hide the repair instructions as an arbitrary exception.

## Executed deterministic/static gates

Environment: macOS, Node **24.19.0**, Bun **1.4.2**, TypeScript **5.9.2**. Package SDKs remain A2A **1.1.0**, Letta Agent SDK **0.8.3** / local Letta Code **0.31.7**. Existing Docker-lab versions were not changed.

```bash
(cd packages/letta-a2a-client && bun install --frozen-lockfile && bun run check)
(cd packages/letta-a2a-bridge && bun install --frozen-lockfile && bun run check && bun run build)
(cd examples/14-typescript-letta-agent-sdk && bun install --frozen-lockfile --force && bun run check && bun test tests)
bun run check
bun test
git diff --check
```

Final root result: **185 passed, 0 failed, 786 assertions across 28 files**. Example 14: **14 passed**. Checks include real separate-process file locking/write preservation, service reopen, ambiguous continuation, delayed persistence, alias/context serialization, deadline races, typed protocol transport/SSE, both adapter surfaces, and owner disposal.

Build order matters: build the two packages before refreshing Example 14's copied file dependencies. Bun reported dependency peer/postinstall notices during SDK development-dependency installation; no assertion of a warning-free dependency tree is made.

## Packed Node consumer

Executed `.letta/checks/pack-client.sh`: `npm pack`, then an isolated npm consumer installed the archive with lifecycle scripts disabled. Ordinary Node imported the core and adapter entries, found declaration output, constructed both tools and disposed them. The optional Letta SDK peer was **not installed** in that consumer.

```text
PACKED_NODE_IMPORT_TYPES_AND_TOOL_DISPOSAL_OK v24.19.0
```

This proves archive composition/imports and local disposal, not a published-registry installation or a packed live Letta runtime. Temporary consumer files were removed.

## Provider-backed SDK/mod acceptance

Executed the ignored `.letta/checks/package-live.mjs` harness against refreshed Example 14 file dependencies, using only the existing OpenAI credential in the child environment and economical `openai/gpt-4.1-nano`.

Each peer/caller used an isolated temporary home, backend, working directory, and loopback port. SDK mode had no global client mod. Mod mode copied the built bundled entry into that isolated home's mods directory. A separate test-owned composition denied `a2a_invoke` through the **real SDK** `canUseTool` callback.

For both adapters, the harness verified direct two-turn memory, then actual nested calls on two caller turns. Peer task-list readback proved the calls happened, returned completed tasks, shared one remote context, and recalled the remote codeword across newly created caller SDK sessions. Denial was verified by observing the actual policy callback and **no new peer task**, not just a model saying it was denied.

```text
DIRECT_AND_TWO_TURN_OK
NESTED_SDK_TWO_TURN_WITH_PEER_READBACK_OK
DIRECT_AND_TWO_TURN_OK
NESTED_MOD_TWO_TURN_WITH_PEER_READBACK_OK
REAL_SDK_APPROVAL_DENIAL_OK
ISOLATED_TEST_HOMES_CLEANED
```

Raw logs, the private error-instrumentation helper, and the denial fixture remain ignored under `.letta/checks/`. Credentials were not written into source, state journals, or evidence. The harness removed its temporary homes and cleaned up its owned process groups.

## Limits / next slice

- Phase 3 remains: full bridge protocol/policy seams, trusted caller projection, OAuth/credential ownership, delegation and push policy. Mature service convergence and crash recovery remain Phases 4/5.
- The initial bridge remains loopback/shared-domain, text-only, new-task-only, and in-memory. Client capability does not silently broaden it.
- Direct SDK clients returned by `connect` have caller-owned execution/lifetime semantics; only the convenience facade journals and serializes invocations.
- Unknown submissions require explicit operator reconciliation. No automatic correlated-history recovery, orphan-lock reclamation, exactly-once promise, or transparent mid-turn reconnect is implemented.
- Fresh-session tool re-registration was exercised. Provider-backed disconnect/reconnect recovery and live cancellation of a running model were **not** added to this live harness; cancellation/cleanup race evidence here is deterministic.
- Cross-process lock behavior and file reopen were tested; the live nested proof uses fresh SDK sessions rather than restarting the entire bridge. Restarting the narrow bridge still loses its inbound in-memory mapping.
- No Docker/Python protocol matrix, OAuth/gateway suite, Cloud backend, additional OS/Node version, package publication, deployment, or Git delivery was performed in this slice.
