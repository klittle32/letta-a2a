# Phase 3: protocol and policy checkpoint

Date: 2026-09-11. Base: `85f49a9`. Implementation is **uncommitted** in worktree `.letta/worktrees/a2a-phase-3`, branch `letta/a2a-phase-3-8f605321`. No push, publication, deployment, or service convergence occurred.

## Implemented

- Guarded official A2A handler composition: discovery, sends/streams, get/list/cancel/subscription, push CRUD, and disabled extended-card behavior. Text/media rejection occurs before execution. Explicit settled input/auth interruptions support same-task continuation; conflicting, active, terminal, and unresolved execution rejects safely.
- Immutable authenticated issuer/subject/tenant projection, request-local operation authorization, owner-scoped task/conversation/push behavior, and private/no-store protected discovery. Agent memory remains shared across that agent's conversations.
- Client destination/credential-origin separation, stable peer/owner identity, protected host headers, refresh identity checks, and identity-aware continuity. OAuth/token acquisition remains application-owned.
- Existing-agent persisted-tool ID preflight inside the turn lock; separate connection-owned approval policy. Explicit delegation/hop helper and trusted scope projection.
- Official push store/sender seams with exact URL/Bearer policy, protocol credential redaction, ordered V1 callbacks, bounded retries, late-response cleanup, and bounded/idempotent bridge cleanup.

JWT/provider fixtures live in root `tests/` and `scripts/`, not package implementation. The mature service and its dependency versions remain unchanged.

## Executed verification

Environment: macOS, Node **24.19.0**, Bun **1.4.2**, package A2A SDK **1.1.0**, Letta Agent SDK **0.8.3**, its Code runtime **0.31.7**. Root lab remains A2A SDK **1.0.1** / Code **0.30.25**.

| Gate | Observed result |
| --- | --- |
| Full root `bun test` | **243 passed, 0 failed; 1,141 assertions; 36 files** |
| Root `bun run check` and `bun run build` | Passed |
| Client `bun run check` | Source/test types and library/mod build passed |
| Bridge `bun run check` / `bun run build` | Strict source/test types and declarations/build passed |
| Example 14 frozen forced refresh and `bun run check` | Passed; its tests also passed in root suite |
| Prettier 3.6.2 on changed TS/live fixture; `git diff --check` | Passed |
| Extracted npm tarball Node imports/disposal | Passed using symlinked, frozen package dependencies; **not** a fresh registry install/platform matrix |
| Independent final security/lifecycle review | Prior blockers re-reproduced as fixed; no remaining confirmed blocker in reviewed scope |

The first full-suite attempt lacked Example 14's file dependencies: 230 tests passed and three import errors occurred. Building both packages and refreshing the example resolved setup; the final counts above are the subsequent complete run, not that failed attempt.

### Direct endpoint proof

`tests/packages-phase3.test.ts` runs a test-owned RSA JWT/client-credentials issuer, actual loopback HTTP listeners, and the official client through package policy. It checks invalid signature/expiry/issuer/audience and anonymous denial, discover-only permissions, concurrent different scopes for one principal, issuer/subject/tenant isolation, metadata spoofing, interruptions/continuation/stream snapshots/history/filtering, terminal subscription rejection, trusted delegation header propagation, and actual Bearer-authenticated V1 push delivery/CRUD/redaction.

Package-local tests cover client credential refresh/drift, origin and header restrictions, duplicate/active task reservations, interrupted generation behavior, disconnected iterator persistence, existing-agent governance, hop validation, and push retry/late-body/shutdown boundaries. These are declared-profile tests, not a blanket certification of every A2A transport/extension.

### Live Letta SDK proof

Reproducible fixture: `scripts/phase3-live.mjs`. Run after building the bridge, with an existing `OPENAI_API_KEY`:

```sh
node scripts/phase3-live.mjs --run
```

It creates a fresh temporary local backend, HOME, working directory, and agent; no existing agents or global mods are modified. The supervisor allowlists environment fields, suppresses arbitrary SDK/provider logs, bounds execution, reaps its owned process group, and removes temporary state.

Parent independently reran the final fixture with `openai/gpt-4.1-nano`. Observed:

- Three turns, three actual inventory reads/guards.
- Immutable caller and delegation data reached session composition.
- Caller A continued the same actual SDK conversation and recalled the codeword; caller B used a different SDK conversation despite the same raw protocol context ID.
- One approved tool executed; one tool was denied; denied-tool executions stayed zero.
- Cleanup and temporary-state removal both passed.

This live proof uses a trusted **direct handler context**, not JWT. JWT/HTTP verification is the separate deterministic integration fixture. Earlier live debugging produced a false recall observation by searching serialized chunks instead of joining artifact text; the final fixture joins text and asserts recall. It also uses ordinary rather than stateless SDK sessions; the earlier false result is not evidence that stateless mode caused it.

## Review findings resolved

1. Concurrent tokens for one owner could overwrite a global scope cache. Authorization now receives original request context; scopes stay request-local. Both direct and real-JWT concurrency tests prevent regression.
2. A foreign caller could reserve another owner's cancellation before ownership lookup; active continuation errors also disclosed task existence. Owner lookup now precedes shared reservations and activity checks. Independent repro: foreign cancel rejects, owner cancel succeeds; foreign active and nonexistent continuations both report not found.
3. Rejected client responses and late push responses needed body cleanup. Cleanup is attempted on rejected/late responses; noncooperative push cleanup reports incomplete.
4. Protected headers are checked in both Request and init sources, avoiding reliance on custom-fetch header normalization.
5. Push close is integrated, bounded, idempotent, preserves callback binding, and propagates incomplete cleanup instead of reporting unconditional success.

## Remaining boundaries

- Phase 4 service convergence and legacy delegation/deployment composition are next; unchanged Docker examples were not rerun as a full live matrix.
- Phase 5 durable recovery, crash-window reconciliation, retention, and multi-process enforcement remain unimplemented. A durable task store alone is insufficient.
- Bridge execution is text-only. Extended cards are disabled; REST/gRPC, arbitrary extensions/signatures, and broad OS/backend coverage are not claimed.
- Application transport, credential provider, custom fetch/store, and runner adapters remain trusted. Inventory preflight cannot atomically prevent external administrators changing agent tools.
- Publication, deployment, Git commit/push, and further work require their respective authorization; this checkpoint does not perform them.
