# Phase 4 — mature service convergence

Date: 2026-09-11. Implementation checkpoint, not a release or production deployment.

## Delivery boundary

Phase 3 was committed as `02ca6a27e1efb5a5caaf1b206d11c5db9ed6edc6`, fast-forwarded to `main`, pushed to `origin`, and its worktree/branch removed. Phase 4 is implemented **uncommitted** in `.letta/worktrees/a2a-phase-4`, branch `letta/a2a-phase-4-a241730a`, based on that commit. Phase 4 delivery and Phase 5 execution remain separate actions.

## Implementation

- Service runtime uses public Letta Agent SDK 0.8.3 and package `AgentSdkTurnRunner`, with explicit agent bootstrap, strict per-turn tools, persisted-inventory checks, bounded cancellation, and outbound settlement drain.
- Each service binding composes the package handler/router, ownership, streaming, push, delegation, and shutdown. Custom executor/push/delegation implementations and unused raw stream/JSON-RPC decoders were removed.
- Outbound lab compatibility is a thin adapter around the public official-client provider and invoker. OAuth owner/audience/destination policy is explicit; legacy hop metadata and its protected header remain compatible with the Python peer. Input/auth interruptions return identity and status instead of polling to timeout.
- Service JWT verification matches gateway claims/scopes/singular-role policy and keeps authorization request-local. Only bridge routes retain Authorization for independent verification; reference and ADK routes strip it.
- A small optional SDK-runner mapping adapter preserves owner-scoped idle conversations. Persistence runs within serialization; writes publish only after successful storage. Legacy unowned mappings remain on disk without automatic adoption.
- Root/Docker consume built local packages using A2A JS SDK 1.1.0. Docker builds packages before installing root file dependencies. The App Servers remain on Code 0.30.25; no runtime upgrade was necessary.

## Executed gates

| Gate | Result |
|---|---|
| Root `bun test` | **262 passed**, 1,241 assertions, 38 files |
| Root TypeScript check/build | Passed |
| Bridge source/test type checks and build | Passed |
| Client type check/build, including mod bundle | Passed |
| Example 14 frozen dependency refresh and TypeScript check | Passed |
| Reference-agent frozen uv environment + pytest | **43 passed** |
| Google ADK frozen uv environment + pytest | **17 passed**; upstream deprecation/experimental warnings remain |
| Managed provider-free core Docker protocol matrix | Passed |
| Final managed provider-backed core Docker matrix | Passed with `openai/gpt-4.1-nano` |
| Final provider-free Example 12 ADK matrix | Passed, including token stripping and gateway/ADK correlation |
| Independent follow-up review | No remaining blocker; 51 focused tests independently passed |
| Diff whitespace and isolated-stack cleanup | Passed; no matching test containers remained |

The final live core matrix verified reference streaming/failure/disconnect retrieval, async sends/polling, continuation, terminal failure/cancellation, Letta card rewriting, duplicate-safe authenticated push, assistant-text streaming, **Letta Agent A → Python reference agent**, **Python reference agent → Letta Agent A**, nested child cancellation, and omission of tested credentials from logs. Both Letta containers bootstrapped; this matrix is not a claim of a separate provider-backed Agent A ↔ Agent B conversation proof.

## Reproduction

Use the README's package-first frozen install/build sequence, then:

```sh
bun run check
bun run build
bun test
(cd services/reference-agent && uv sync --frozen && uv run pytest)
(cd services/google-adk-agent && uv sync --frozen && uv run pytest)
node scripts/integration-example-12.mjs
```

Core protocol-only mode is `A2A_SKIP_LIVE_LETTA=1 node scripts/integration-a2a.mjs`. The live gate requires `OPENAI_API_KEY` and used `LETTA_TEST_MODEL=openai/gpt-4.1-nano`. Run in managed mode with a fresh project/free ports. This session explicitly unset inherited `PUSH_RECEIVER_PORT`, `A2A_GATEWAY_PORT`, `A2A_GATEWAY_UI_PORT`, `OAUTH_PORT`, `A2A_INTEGRATION_NO_MANAGE`, `A2A_INTEGRATION_PROJECT`, and the four `A2A_INTEGRATION_*_PORT` overrides; the live run also unset `A2A_SKIP_LIVE_LETTA`. Do not reuse occupied ordinary-lab ports. Every managed stack removed its own containers, networks, and volumes in cleanup; the existing ordinary lab was not targeted.

## Regressions caught and resolved

1. **Real SDK bootstrap:** SDK 0.8.3 rejects session-only `allowedTools`, `disallowedTools`, and `canUseTool` in remote `createAgent`. A permissive fake client missed this. A real public-SDK/WebSocket regression now exercises the creation boundary; strict policy remains on sessions. Actual isolated Code 0.30.25 creation, inventory retrieval, readiness, and service connection succeeded before the complete live matrix.
2. **Mounted discovery:** without a trailing slash, SDK relative card resolution dropped the target segment and requested `/a2a/.well-known/agent-card.json`. The service now supplies a directory URL. Its fixture asserts the exact discovery path, not merely the `.well-known` suffix.
3. **JWT parity:** missing `nbf`/scope/role and alternate `roles`-array authority could diverge from gateway policy. Negative regressions failed before tightening direct verification.
4. **Token destination:** global preservation also forwarded tokens to ADK, violating Example 12's audit assertion. Verified gateway header-modifier configuration now strips tokens from non-bridge routes; the unchanged live audit passed afterward.
5. **Cancellation coverage:** restored canceled-partial-output regression confirms no final artifact marker. A separate existing positive-cancellation test exhausted its 20ms cleanup fixture budget under concurrent build load; only that test's cleanup allowance was increased. Production deadlines and bounded-cleanup tests were not relaxed.

## Limits

No durable task/push/in-flight recovery, legacy-owner migration, multi-process ownership, richer bridge media execution, registry publication, production deployment, or broad OS/backend certification is claimed. Persisted IDs do not justify blind replay after a crash; shared agent memory is not tenant isolation. Example 12's provider-free check did not start Hermes or call a live ADK model. Phase 5 remains future work.
