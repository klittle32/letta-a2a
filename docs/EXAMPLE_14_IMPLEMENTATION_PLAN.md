# Example 14 implementation plan

## Goal

Demonstrate narrow protocol composition rather than another A2A feature: a Letta agent sends a task through the existing `agentgateway`, a thin A2A adapter maps that task to a persistent [ACPX](https://github.com/openclaw/acpx) session, and ACPX talks to Claude through `claude-agent-acp` and the Claude Agent SDK.

```text
Letta A2A caller
  → agentgateway
  → thin A2A-to-ACPX adapter
  → acpx claude
  → claude-agent-acp
  → Claude Agent SDK
```

The adapter is transport plumbing, not a third logical agent. The first implementation supports one server-selected Claude profile, one minimal immutable workspace, separately persisted ACPX session state, final assistant text, two-turn continuation, failure, and cancellation.

## Acceptance criteria

1. One private Docker service exposes an A2A 1.0 Agent Card and task endpoint behind `/a2a/claude-acp` on the existing JWT-protected `agentgateway`. The card declares the existing OAuth2 client-credentials flow and scopes; the backend port is not published.
2. The container pins ACPX and its Claude adapter in a lockfile. The researched baseline is `acpx 0.13.2`, whose built-in `claude` entry resolves to `@agentclientprotocol/claude-agent-acp@^0.60.0`; exact package artifacts and digests are rechecked and frozen when implementation starts.
3. The server chooses the agent command, absolute working directory, session-name derivation, model option, permission policy, timeout, and tool capabilities. No A2A field can supply shell text, an executable, arbitrary argv, cwd, ACP profile, model, or permission mode.
4. The adapter maps each A2A `contextId` to an opaque, filesystem-safe ACPX session key. The mapping and complete ACPX session store survive adapter restart, while the ACPX agent command and absolute cwd remain fixed so ACPX continues resolving the same session identity. A missing, corrupt, or unexpectedly replaced stored session fails that context safely; it never silently attaches the old A2A context to a fresh or unrelated Claude session.
5. The adapter embeds ACPX's public `acpx/runtime` API. Before the first prompt it idempotently calls `ensureSession()` in persistent mode, then calls `startTurn()` in prompt mode—never one-shot `exec`. A2A text is passed as the runtime's `text` value, not interpolated into a shell command.
6. The ACPX runtime uses `permissionMode: "deny-all"` and `nonInteractivePermissions: "fail"`. The container root and `/workspace` are read-only; only `/data/acpx` and a size-bounded `/tmp` are writable, plus a dedicated Claude credential volume only when the chosen authentication mechanism requires refresh writes. The image contains no operator files, and the container exposes no host, repository, Docker-socket, or SSH mounts. Tests prove writes outside the allowlist fail and permission/elicitation requests do not wait for an interactive UI.
7. The adapter consumes ACPX's typed event stream and terminal `result`. It publishes only ordered `text_delta` events whose stream is not `thought`, then exposes the assembled final assistant text as the completed A2A artifact. Accumulation is capped at 65,536 UTF-8 bytes and 10,000 events per turn; crossing either limit cancels the ACP turn and fails the A2A task with a sanitized `output_limit_exceeded` result rather than truncating a nominal success. Status, thinking, tool calls, diffs, raw errors, credentials, and provider internals do not cross the A2A boundary.
8. Two A2A messages with one context ID produce two prompts in one ACPX Claude session. The second response demonstrates recall of a distinctive value from the first turn.
9. Concurrent messages for one context are serialized. Different contexts may run independently within an explicit process/concurrency limit.
10. `CancelTask` calls `turn.cancel()` for the exact active ACPX turn, waits for its terminal result with a bounded fallback, and only then settles the A2A task as canceled. Unknown event types stay private; failure, timeout, missing final text, and adapter/agent exit become sanitized failed tasks without corrupting the session mapping.
11. A provider-free test uses a fake ACP server through real ACPX to prove session creation, two-turn continuation, output parsing, failure, and cancellation. A separate opt-in live smoke test uses Claude and returns one final text artifact through the full Letta → gateway → adapter → ACPX path.
12. The existing deterministic and live A2A suites remain green. No claim is made about ACP features that the adapter does not project.

## Design

### A2A owns the network task; ACP owns the local agent session

The adapter should implement the normal A2A task lifecycle with the repository's existing A2A SDK patterns:

1. Accept `SendMessage` and create an A2A task.
2. Derive the stable context-to-session key.
3. Ensure the ACPX persistent session through `acpx/runtime`.
4. Start one prompt turn and consume its typed events and terminal result.
5. Publish one text artifact and a terminal A2A status.
6. Keep `GetTask` authoritative and route `CancelTask` to the active ACPX session.

Do not expose ACPX itself over HTTP or let the caller address ACP methods directly. A2A task IDs, A2A context IDs, ACPX record/session IDs, and any provider-native Claude session ID remain distinct identifiers.

### Stable session identity

ACPX scopes a persistent session by:

```text
(agent command, absolute cwd, optional session name)
```

The adapter therefore uses one immutable agent entry (`claude`), one canonical absolute cwd (for example `/workspace`), and a deterministic internal session key derived from a full cryptographic hash of the A2A agent key plus context ID. Do not use raw external IDs as filenames or runtime-visible names. ACPX's session store persists the resulting handle; a second mapping database is unnecessary unless implementation evidence proves otherwise.

On reuse, inspect the stored record and returned handle as one lineage. Missing or corrupt records, or an unexpected provider/session-ID replacement during `ensureSession()`, mark that A2A context unavailable and fail the current task. Recovery is explicit: the caller starts a new A2A context, or the operator resets the broken mapping and records that continuity was lost. Never let ACPX's fallback-to-new-session behavior masquerade as successful continuation.

The embedded seam should stay structurally equivalent to:

```ts
const runtime = createAcpRuntime({
  cwd: "/workspace",
  sessionStore: createRuntimeStore({ stateDir: "/data/acpx" }),
  agentRegistry: createAgentRegistry({
    overrides: { claude: ["/opt/acpx/bin/claude-agent-acp"] },
  }),
  permissionMode: "deny-all",
  nonInteractivePermissions: "fail",
  timeoutMs,
});

const handle = await runtime.ensureSession({
  sessionKey: contextDigest,
  agent: "claude",
  mode: "persistent",
  cwd: "/workspace",
});

const turn = runtime.startTurn({
  handle,
  text: requestText,
  mode: "prompt",
  requestId: a2aTaskId,
  timeoutMs,
  signal,
});
```

Exact option and event types must be contract-tested against the pinned package. The ACPX CLI remains useful only as a manual diagnostic surface—for example, `acpx --cwd /workspace claude sessions show`—not as the adapter's process protocol.

### Fixed, read-only workspace

This example is conversational, not a remote coding service. Build a minimal workspace into the image and keep the root filesystem and `/workspace` read-only. The process may read immutable image contents and its own ACPX state; only `/data/acpx`, bounded temporary storage, and an explicitly required isolated Claude-auth volume may be writable. Do not mount the repository, Docker socket, SSH directory, operator home, or any other host data.

The runtime's public API does not currently expose the CLI's `--no-fs` and `--no-terminal` switches. Do not claim those callbacks are absent. The enforceable boundary is narrower and concrete: no operator data is present, writes outside the named paths fail at the filesystem layer, and ACPX denies permission requests. Contract and container tests must attempt forbidden workspace/root writes and confirm failure.

The restriction is enforced by the runtime permission policy and container/filesystem configuration—not by asking Claude to behave. If the adapter receives a permission or elicitation request despite that configuration, it fails closed.

### Pinned adapter resolution

ACPX normally resolves its built-in Claude adapter through `npx`. Runtime package downloads would make the example nondeterministic. Bake the exact ACPX and `claude-agent-acp` packages into the image and pass a stable local argv override to `createAgentRegistry()` for the `claude` entry. Verify the resolved command during the image test and keep it stable across restarts and upgrades.

### Cancellation and locking

Maintain one active prompt record per mapped session. A same-context request waits behind that session's lock; it must not start a second ACP process against the same session. On A2A cancellation:

- mark cancellation requested;
- call `turn.cancel()` for the exact active turn;
- await the canonical `turn.result` after ACPX finishes checkpoint and cleanup work;
- use bounded runtime/session close only if cooperative cancellation does not settle;
- prevent a late completion from overwriting the canceled terminal state.

Canceling one context must not target another context's session.

### Authentication boundary

Caller authentication and authorization remain at `agentgateway`; the private adapter does not receive or need the caller's OAuth token because the gateway validates and strips it. Claude credentials are a separate operator-to-provider boundary. They live in a dedicated runtime secret/credential volume and never in source, images, A2A messages, artifacts, or logs.

The live Claude path is a personal, opt-in experiment. Do not describe subscription OAuth as suitable for a multi-user or employee service, and do not make billing or plan-entitlement claims. ACP chooses a protocol, not a billing route.

## Expected implementation surface

- `services/acpx-agent/` — A2A adapter, ACPX runtime wrapper, deterministic context-key helper, Dockerfile, and tests.
- A pinned package manifest/lock containing ACPX, `claude-agent-acp`, and the existing A2A SDK dependency needed by the service.
- `agentgateway/config.yaml` — `/a2a/claude-acp` route through the existing security policy.
- `compose.yaml` — optional/profile-gated adapter, private state volume, read-only workspace, and runtime secret mount.
- `examples/14-a2a-to-acpx-claude/` — the completed walkthrough only after behavior exists.
- Provider-free fake-ACP fixtures, protocol integration coverage, one opt-in live smoke, and an executed evidence note.

## Test-first slices

1. Add failing configuration tests for one allowlisted Claude profile, exact package pins, fixed cwd, private networking, read-only mounts, deny-all permissions, and absence of committed credentials.
2. Add failing context-key/session-store tests for opaque names, path-hostile context IDs, restart recovery, stable command/cwd identity, and distinct A2A/ACPX/provider identifiers.
3. Build a deterministic fake ACP stdio server and first prove its persistent two-turn, stale/corrupt-session failure, and cancellation behavior through the pinned real `acpx/runtime` API.
4. Add failing runtime-wrapper tests for fixed registry argv, typed event filtering, the 65,536-byte/10,000-event limits, timeout, cancellation cleanup, and secret-safe errors.
5. Add failing A2A handler tests for submitted/completed/failed/canceled states, one final text artifact, late-result suppression, and same-context serialization.
6. Implement the smallest adapter and add its gateway route, health check, state volume, and read-only workspace.
7. Extend the provider-free Docker matrix to call the fake-ACP-backed route through `agentgateway`, continue one context across two tasks, and cancel a blocked task.
8. Add the opt-in Claude credential setup and one full live Letta delegation through `agentgateway`. Verify the adapter resolves the baked Claude ACP command without downloading packages at runtime; use a direct ACPX live smoke only as a diagnostic if that full path fails.
9. Write the Example 14 README, expected output, filtered logs, and evidence record.

## Explicit non-goals

- request-selected ACP agents, commands, models, workspaces, or permission policies;
- Codex, `letta-acp`, Gemini, or multiple ACP profiles in the initial example;
- general-purpose remote coding or workspace synchronization;
- host/repository access, shell access, or projecting ACP file/terminal callbacks into A2A;
- interactive permission forwarding or automatic approval;
- ACP thinking, tool, plan, diff, terminal, or rich-event projection;
- A2A streaming, push notification delivery, file/image parts, or multi-agent orchestration;
- exact parity with the interactive Claude Code TUI;
- production multi-tenant isolation or employee use with personal subscription OAuth;
- billing, quota, or subscription-eligibility claims.

## Upstream references checked for this plan

- [ACPX repository and session model](https://github.com/openclaw/acpx)
- [ACPX embedded runtime at the reviewed `0.13.2` source revision](https://github.com/openclaw/acpx/blob/9ace84727fc219fd15ccec84963af14536efd275/src/runtime.ts)
- [ACPX runtime contract](https://github.com/openclaw/acpx/blob/9ace84727fc219fd15ccec84963af14536efd275/src/runtime/public/contract.ts)
- [ACPX CLI reference at the reviewed revision](https://github.com/openclaw/acpx/blob/9ace84727fc219fd15ccec84963af14536efd275/docs/CLI.md)
- [ACPX agent registry at the reviewed revision](https://github.com/openclaw/acpx/blob/9ace84727fc219fd15ccec84963af14536efd275/docs/agents.md)
- [`claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp)
- [Agent Client Protocol](https://agentclientprotocol.com/)
- [Anthropic's current Claude Agent SDK plan guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
