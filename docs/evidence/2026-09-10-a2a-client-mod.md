# Letta A2A client mod evidence — 2026-09-10

## Scope

This proof exercised the packaged outbound `a2a_invoke` mod directly against the Example 14 TypeScript Letta A2A server. No agentgateway, Rust CLI, MCP server, OAuth fixture, or skill participated.

## Static and unit validation

From `packages/letta-a2a-client`:

```text
bun test       15 passed, 0 failed
bun run check  TypeScript passed; bundled 54 modules into dist/a2a-client.mjs
```

The focused tests cover route validation, atomic context-state persistence, concurrent writes from separate store instances, automatic context reuse, fresh-context override, unknown-target rejection, same-context serialization, cancellation while queued, asynchronous task polling, immediate message results, terminal failure propagation, and remote cancellation after local abort or timeout.

Example 14 also passed its frozen install, three focused tool-policy tests, and TypeScript check with SDK sessions restricted to `allowedTools: ["a2a_invoke"]`.

## Packaged installation proof

The mod was installed into an isolated temporary home with the ordinary local-path command:

```text
letta install ./packages/letta-a2a-client
Installed npm:letta-a2a-client@0.1.0
```

The managed registry enabled `dist/a2a-client.mjs`. That entry is self-contained and includes the pinned official A2A SDK, so it does not rely on `node_modules` being copied during local-path installation. A subsequent headless Letta Code launch reported zero mod diagnostics.

## Live Letta-to-Letta proof

An isolated Example 14 server ran on `127.0.0.1:41243` with `openai/gpt-4.1-nano`. A separate isolated Letta Code caller loaded the installed mod and called the configured `local-example` route.

The first direct delegation returned:

```text
MOD_A2A_OK
```

A persistent caller conversation then sent:

```text
Remember the continuity codeword PERSIMMON. Reply with exactly STORED.
```

The remote returned `STORED`. A later process reopened that exact local Letta conversation and called the same target without supplying `context_id`. The mod loaded its saved remote context, and Example 14 returned:

```text
PERSIMMON
```

The state file contained the expected `agent ID / local conversation ID / target` mapping and no message content or credentials.

## Inbound-to-outbound Example 14 proof

A second isolated Example 14 server ran on `127.0.0.1:41244` with the packaged mod installed and a `target-b` route to the first server. An ordinary A2A client sent this top-level request to the second server:

```text
Use a2a_invoke with target target-b and message "Reply with exactly STRICT_NESTED_OK".
```

The observed path was:

```text
A2A client -> Example 14 agent A -> a2a_invoke -> Example 14 agent B
```

The outer A2A task reached `TASK_STATE_COMPLETED` and streamed:

```text
STRICT_NESTED_OK
```

The first attempt used SDK `permissionMode: "strict"` without a permission callback and exposed an `approval_conflict`: a noninteractive SDK turn cannot complete an approval round trip even when the mod declares no approval requirement. The final configuration keeps strict mode, sets the request-scoped base client toolset to `none`, allowlists `a2a_invoke`, and supplies a deterministic callback that approves only that tool and denies every other approval request. Reused agents are also rejected if they report persisted tools. The final nested run plus mod diagnostics passed. Three focused policy tests cover the allow, deny, and reused-agent rejection paths; a live stop/start cycle also reused the dedicated tool-free agent successfully.

## Proven limits

- This proves direct A2A 1.0 JSON-RPC routing only; agentgateway and OAuth remain intentionally absent.
- The live proof used text messages and completed tasks. Failure, timeout, and cancellation behavior is covered by focused tests rather than a provider-backed live cancellation probe.
- Remote context storage is local to the machine running Letta Code. Cross-machine state synchronization is not implemented or claimed.
- The nested proof used an explicit delegation request. Protocol hop metadata and loop prevention for mutually delegating Example 14 agents remain outside this mod-only slice.

## Final validation and review

- Repository-wide `bun test`: 61 passed, 0 failed
- Repository-wide `bun run check` and `bun run build`: passed
- Mod package `bun test`: 15 passed, 0 failed
- Mod package `bun run check`: passed and rebuilt the 54-module runtime bundle
- Example 14 frozen install, 3 policy tests, and TypeScript check: passed
- `npm pack --dry-run`: 10 intended files; bundled runtime and reviewed TypeScript source included, tests and development files excluded
- `git diff --check`: passed

An independent strict review first found the cross-key context-store lost-update race, the unsafe unrestricted reused-agent boundary, and one configuration-documentation mismatch. After the lock, strict callback/fail-closed reuse policy, regression tests, and documentation fixes, the independent rereview classified all three findings as resolved and found no new blocker.
