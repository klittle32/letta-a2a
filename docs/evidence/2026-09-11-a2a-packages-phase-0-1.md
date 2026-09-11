# A2A packages: Phase 0 and Phase 1 checkpoint

Recorded 2026-09-11 UTC on macOS with Node.js `24.19.0` and Bun `1.4.2`.

## Scope completed

- Published the reviewed plan to `main` / `origin/main` in commit `d6bfda6`, fast-forward only. Removed the planning worktree and its branch.
- Began implementation in `letta/a2a-packages-implementation-4dd26ed0`. The implementation described here is a working-tree checkpoint, not a published release or another delivered Git commit.
- Pinned the protocol/source baseline and recorded SDK-owned semantics, ownership contracts, recovery hazards, and remaining regression ownership in [LETTA_A2A_CONTRACTS.md](../LETTA_A2A_CONTRACTS.md).
- Added `packages/letta-a2a-bridge` and converted Example 14 to consume its executor, runner, text helpers, tool policy, and loopback composition. Agent creation/reuse and the dedicated tool-free fixture guard remain example-owned.
- Preserved partial client artifacts and separate failure/interruption status text. Documented current continuity, cancellation, and destination-policy limits rather than claiming later-phase features are implemented.

This is a guarded extraction: anonymous loopback, one shared trust domain, text execution, new tasks with context continuation, in-memory state, and application-owned single execution owner. It is not the full package-plan release.

## Test-first corrections

| Regression | Red evidence | Green implementation |
| --- | --- | --- |
| Cancel waiter B behind active A, then enqueue C | Original example runner: 2 of 4 Node tests failed; C opened a session before A settled | Keep the predecessor barrier until the full promise chain settles; package and example fixtures retain coverage |
| Partial artifacts hide failure/input/auth status | Client invoker: 7 new tests failed for missing `statusMessage` | Keep optional status text separate; preserve artifact-first `text` compatibility and stop polling interrupted tasks without canceling them |
| Mixed text/data/raw/URL content is silently stripped | Text helper: 4 tests failed because no exception was thrown | Refuse the complete unsupported message before invoking Letta |
| Synthetic failed SDK result treated as stopped execution | Recovery tests: 3 failures covering ordinary disconnect, cancellation plus disconnect, and failed disposal | Interpret results after disposal; quarantine uncertain/unsuccessful outcomes, with explicit interrupted-result and pending-approval controls |
| Same active task overwrites cancellation ownership | Both ordinary and streaming follow-up tests failed to reject | Reject supplied task IDs before SDK dispatch in the Phase 1 profile; retain executor duplicate protection and outstanding-execution shutdown accounting |

The initial bridge package tests failed before implementation existed. Additional identity/output-mode fixtures also failed before the corresponding extraction-profile guards were added.

Independent strict review reproduced the two later lifecycle defects above. After the fixes, focused re-review confirmed both resolved. The review did not certify deferred authentication, durability, or full protocol conformance.

## Executed deterministic and static gates

All listed commands passed on this checkpoint:

```bash
# Repository root; discovers lab, package, and example tests.
bun test                         # 99 passed, 0 failed
bun run check
bun run build
git diff --check

cd packages/letta-a2a-client
bun run check                    # source typecheck + reproducible bundled mod

cd ../letta-a2a-bridge
bun install --frozen-lockfile
bun run check                    # source AND test types
bun run build                    # Node ESM + declarations
bun test                         # 22 passed, 0 failed; included in root total

cd ../../examples/14-typescript-letta-agent-sdk
bun install --frozen-lockfile --force
bun run check
bun test tests                   # 12 passed, 0 failed; included in root total
```

The installed example's `dist/letta-agent.js` was byte-compared against the freshly built package copy. Source formatting used Prettier `3.6.2`; no repository formatting dependency was introduced.

## Live integration

The final reviewed bridge revision passed a local provider-backed proof using `openai/gpt-4.1-nano`:

1. Start two package-backed Example 14 servers on separate loopback ports, each with an isolated temporary HOME, backend directory, and working directory.
2. Discover both Agent Cards using the official A2A client.
3. Send a unique codeword to the caller, then start a second task in the same A2A context and verify the returned text retains that codeword. Task IDs differ; context ID is preserved.
4. Install the bundled client mod **only in the temporary caller HOME**, with a route to the peer. Ask the caller to invoke the peer.
5. Verify that the peer's task list changes from empty to a completed task and that the mod's persisted remote context matches a peer task's context. This checks actual nested traffic, not merely the caller claiming it used a tool.
6. Terminate the owned process groups and remove both temporary homes. No user-installed mod or existing agent state was changed.

Output:

```text
peer: discovered
caller: discovered
DIRECT_AND_TWO_TURN_OK
NESTED_MOD_WITH_PEER_READBACK_OK
ISOLATED_TEST_HOMES_CLEANED
```

The temporary harness is `.letta/checks/package-live.mjs` in this worktree, intentionally ignored as a raw run artifact. Credentials were supplied through the environment, not written into source or configuration. The procedure above records what was tested; this is not a registry-install, Cloud, or Docker-gateway proof.

## Packed artifact check

`npm pack` produced a local bridge tarball. A clean temporary consumer installed it with Bun, then ordinary Node ESM imported `createBridge`, composed a fake runner without invoking it, and awaited a complete shutdown:

```text
PACKED_NODE_IMPORT_AND_CLOSE_OK
```

Bun reported React peer warnings and blocked three transitive postinstall scripts in that clean consumer. This check proves packed library import/composition/close, **not** provider-backed SDK execution from that tarball. Live SDK execution above used the worktree's frozen, trusted dependency setup. The consumer and tarball were removed.

## Remaining work

Next is **Phase 2: complete the client core and Agent SDK adapter**, including lossless typed results, same-task continuation, task inspection/cancellation, streaming/subscriptions, deadline coverage, and continuity ownership.

The bridge still rejects same-task sends and identity-bearing execution under its explicit extraction profile. OAuth/caller authorization, protocol-error completeness, push/gateway convergence, durable recovery, multi-process ownership, and broader platform/backend verification remain their planned later slices.

No Python or Docker integration suite was rerun for this TypeScript extraction; those implementations were unchanged. No package was published, no application deployed, and the new implementation worktree remains available for review and continuation.
