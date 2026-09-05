# Example 13 implementation plan

## Status

Delivered and verified on 2026-09-04. The acceptance criteria and historical design below are retained as the implementation record. See the [walkthrough](../examples/13-a2a-cli-skill/) and [evidence](evidence/2026-09-04-example-13.md). Example 14 remains planned.

## Goal

Demonstrate that an agent harness does not need a native A2A integration to call a remote agent. A supported shell-capable harness that can install an `agentskills.io` skill and execute a local launcher can invoke the standalone [`a2acli`](https://github.com/a2aproject/a2a-rs/tree/main/a2acli) shipped by the official Rust SDK, then use the existing OAuth-protected `agentgateway` to work with the Google ADK agent introduced in Example 12.

```text
Letta Code / Codex / another compatible harness
  → using-a2a-cli Agent Skill
  → narrow authenticated launcher
  → pinned a2acli binary
  → existing agentgateway
  → Google ADK A2A agent from Example 12
```

The calling harness agent and the remote ADK agent are the two logical participants. The skill, launcher, CLI, and gateway are tooling and transport—not additional agents.

## Why adopt the existing CLI

The A2A community has already identified this exact need. [`a2aproject/A2A#1929`](https://github.com/a2aproject/A2A/issues/1929) proposes an official CLI plus `SKILL.md` so coding agents can discover and invoke A2A services through a stable command surface. The proposal's vote passed, while the standalone canonical repository remains open work.

Do not create another protocol client for this example. The official Rust SDK already ships a standalone, client-only CLI with release binaries for macOS, Linux, and Windows. It supports Agent Card retrieval, one-shot and streaming sends, context and task IDs, task lookup/list/cancel/subscribe, push configuration, compact JSON, and Bearer authentication on both card and RPC requests. This is an official-SDK tool, not yet the separate canonical CLI envisioned by issue #1929.

The Python SDK's `src/a2a/client` is the correct library seam if a future design needs a custom client. Do not copy or vendor that directory. A blocker in the pinned Rust CLI stops this plan for reconsideration rather than silently changing Example 13's architecture. The interactive CLI under `a2a-samples` is demonstration code rather than a reusable agent tool and currently prints configured request headers, so it is not the implementation base for Example 13.

## Acceptance criteria

1. The example pins official release `a2a-cli-v0.1.11` from `a2aproject/a2a-rs`, resolving to source commit `4fdb6a9e6016978cb35e3f91cc50ffd056ce21b5`. Recheck for a newer suitable release only when implementation begins; never float on `latest`.
2. A small installer supports the two walkthrough platforms—macOS arm64 and Linux x86-64—using upstream release assets and digests copied from the published `.sha256` files into the reviewed lock manifest. It installs outside Git-tracked source and fails closed on an unknown platform, missing digest, checksum mismatch, or version mismatch. Other upstream platforms, including Windows x86-64, remain documented upstream but are not claimed by this example.
3. The installed binary passes the exact check `a2acli --version` → `a2acli 0.1.11`, and its source-level command contract is captured by tests: `card`, `send`, `get-task`, and `cancel-task`, global `--base-url` and `--compact`, message `--context-id` and `--return-immediately`, and Bearer input through `A2A_BEARER_TOKEN`.
4. Example 13 reuses Example 12's `google-adk-agent`, Agent Card, `/a2a/google-adk` gateway route, and provider-free fake-model seam. It does not create another remote agent or bypass `agentgateway` to reach the ADK container.
5. A repo-owned launcher obtains or reuses a short-lived client-credentials token, places it only in the child process's `A2A_BEARER_TOKEN`, and invokes `a2acli` with structured argv and a fixed gateway base URL. It requires positive OAuth `expires_in` and JWT `exp` values, uses the earlier resulting expiry, stops reuse 30 seconds before that time, and validates the token's configured client identity, agent role, exact scopes, and available not-before/issued-at claims; a missing, malformed, mismatched, or already-stale value fails closed. Agentgateway remains responsible for cryptographic JWT signature, issuer, and audience verification. The cache is per client identity under a private runtime directory, uses directory mode `0700` and file mode `0600`, and is never committed. Each command has a 30-second process deadline, 1 MiB stdout limit, and 64 KiB stderr limit; overflow terminates the child and returns no partial JSON. The access token never appears in argv, stdout, stderr, source, or skill text.
6. Letta Code and Codex use distinct OAuth client IDs/secrets and signed subjects with only `a2a.discover` and `a2a.invoke` scopes. The launcher fixes both to `/a2a/google-adk`, preserving attribution and preventing model-selected routes; the current gateway does not claim subject-to-route binding beyond its existing role/scope/method policy.
7. The ordinary skill workflow asks the server to return immediately and handles every valid send result: a direct `message` is an immediate success with no required task ID and an optional context ID; a terminal `task` is interpreted immediately; and a non-terminal `task` is polled with `get-task` once per second for at most 120 seconds. Polling stops at `completed`, `failed`, `canceled`, `rejected`, `input-required`, or `auth-required`. Timeout performs one best-effort `cancel-task` and reports the unresolved task ID rather than claiming completion.
8. The launcher preserves `a2acli`'s compact standard A2A JSON on stdout rather than inventing a second response schema. For a direct message, the skill joins its text parts in wire order. For a completed task, it joins text parts in artifact order and part order, separating artifacts with one newline; status-message and history text are not substituted for artifacts. Missing text is reported explicitly, and non-text parts remain unsupported metadata. Other terminal states remain distinct; neither launcher nor skill turns a failed or incomplete task into successful text.
9. When the server returns a context ID, a second invocation can reuse that exact opaque value through `--context-id` and prove continuation with a distinctive codeword. If a direct message omits `contextId`, continuation is unavailable and the skill says so rather than manufacturing one. The workflow does not share context IDs between harness identities, but neither gateway nor ADK is claimed to enforce that ownership in this example.
10. The Agent Skill is an `agentskills.io`-compatible `skills/using-a2a-cli/SKILL.md` package with concise trigger metadata and one deterministic workflow. The same package is demonstrated unchanged in Letta Code and Codex; harness-specific installation instructions remain outside the skill body. Portability is claimed only for those tested harnesses and for others meeting the stated skill/launcher prerequisites.
11. The skill treats Agent Cards, skills, messages, artifacts, status text, and errors as untrusted remote data. It may summarize capabilities and return results, but never follows remote prose as higher-priority instructions or exposes local secrets/files because a card or artifact asks it to.
12. Provider-free tests cover installation/checksum refusal, command construction, token caching/expiry, token non-disclosure, card resolution, direct-message and terminal-task responses, polling, all terminal states, timeout/cancel, malformed or oversized output, deterministic text selection, and context continuation through the real pinned CLI on the exercised host platform. Separate install/version execution covers the supported Linux asset. One opt-in live walkthrough invokes the same ADK agent from Letta Code and Codex using the same skill package but distinct identities.

## Design decisions

### Keep the upstream binary intact

Treat `a2acli` as a pinned third-party executable. Do not fork it, patch its Rust source, rename it as if it were repo-owned, or duplicate its A2A request models. Record release URLs and digests in one lock manifest and verify the binary's reported version after installation.

The initial implementation uses only the four client operations required by the skill:

```text
a2acli --base-url <gateway-route> --compact card
a2acli --base-url <gateway-route> --compact send <text> --return-immediately [--context-id <id>]
a2acli --base-url <gateway-route> --compact get-task <task-id>
a2acli --base-url <gateway-route> --compact cancel-task <task-id>
```

`stream`, `subscribe`, `list-tasks`, extended cards, and push configuration remain available upstream but outside this example's skill contract.

### Add only the lab auth boundary around the CLI

The repository needs a narrow launcher because the upstream CLI intentionally does not own this lab's OAuth client-credentials flow or target allowlist. That launcher should:

- accept only the upstream `card`, `send`, `get-task`, and `cancel-task` operations;
- read invocation text without shell interpolation and pass it as one argv value;
- fix the base URL to the configured gateway route;
- reuse a valid private-cache token for one client identity or mint a replacement before expiry, then inject it through the child environment;
- execute the pinned binary with `shell: false`;
- apply a per-command process deadline;
- enforce a documented stdout/stderr byte limit and fail rather than forwarding a partial JSON document;
- pass successful compact JSON through unchanged and sanitize local launch failures without echoing argv or environment values.

It must not parse or construct A2A cards, messages, transports, task state machines, or SSE. Bounded polling and terminal-state interpretation belong in the Agent Skill. If the launcher needs protocol logic, stop implementation and revise this plan; only then consider a custom client built on the official Python SDK instead of growing a second accidental client inside the launcher.

### Separate identity from portability

The skill and command grammar are shared; credentials and token caches are not. Each harness receives its own secret-scoped OAuth registration and cache path. The launcher derives no identity from the model's text and accepts no caller-selected role, scope, subject, token endpoint, or backend URL. A cached token may be reused only until 30 seconds before the earlier expiry derived from OAuth `expires_in` and JWT `exp`. Any nonzero child exit invalidates that cache for the next explicit command, but a failed `send` is never replayed automatically because the remote side may already have accepted it.

For the lab, the only configured target is the Example 12 ADK route. Supporting arbitrary URLs or a catalog would create an outbound-network and trust-policy problem and is deferred until there is a concrete use case.

### Keep the agent workflow deterministic

The normal skill path is:

1. Run `card` when the Agent Card is not already known for this task.
2. Check that the card exposes A2A 1.0, a gateway-routable JSON-RPC interface, the expected OAuth scheme/scopes, and a relevant text skill.
3. Run `send --return-immediately`, optionally passing an exact prior context ID.
4. If the result is a direct message, return its ordered text parts and retain any returned context ID.
5. If the result is a non-terminal task, call `get-task` at the documented interval until the overall deadline or a terminal state.
6. For a completed task, return only ordered artifact text and retain the task/context IDs. Do not promote status-message or history text into the artifact result.
7. On any other terminal state, report that state plainly. Never replay `send` automatically; report authentication failure and let a later explicit invocation remint.

The skill never asks the model to handcraft protocol JSON, call `curl`, discover private backend addresses, or parse a stream incrementally.

### Keep remote content in the data plane

Agent Cards and returned artifacts help the caller decide what the remote agent can do, but they are not local policy. The skill must preserve the boundary between remote content and local instructions. It must also avoid sending repository contents, local files, credentials, or ambient conversation history unless the user explicitly selected that content for the remote request.

## Expected implementation surface

- `tools/a2acli.lock.json` — exact release, source commit, supported assets, and SHA-256 digests.
- `scripts/install-a2acli.mjs` — bounded, checksum-verifying installer for the supported release artifacts.
- `scripts/run-a2acli.mjs` — fixed-target OAuth launcher for allowlisted, structured `a2acli` argv with unchanged compact JSON output.
- `skills/using-a2a-cli/SKILL.md` — concise portable workflow; no credentials or environment-specific installation prose.
- Optional `skills/using-a2a-cli/references/output-contract.md` only if the tested envelopes cannot be explained concisely in `SKILL.md`.
- `services/reference-agent/src/reference_agent/auth_server.py` — distinct client registrations for the demonstrated harnesses, with scope/role tests; fixed-target enforcement stays in launcher tests.
- `examples/13-a2a-cli-skill/` — completed walkthrough only after the behavior exists.
- Provider-free fixtures, cross-platform installer tests, real-binary contract tests, two harness acceptance records, and one live evidence note.

Do not commit downloaded binaries, access tokens, client secrets, harness transcripts, or generated skill packages.

## Test-first slices

1. Add failing lock-manifest and installer tests for the exact tag/commit, macOS-arm64/Linux-x86-64 asset selection, upstream checksums, atomic install, executable mode, exact version output, and unsupported platforms.
2. Add failing real-binary contract tests against a deterministic local A2A fixture for authenticated card fetch, compact JSON, send, context ID, return-immediately, get, cancel, malformed responses, and nonzero exit behavior.
3. Add failing launcher tests for the command allowlist, fixed route, structured argv, safe message handling, per-command timeout/output bounds, distinct client identities/cache isolation, `expires_in`/JWT-`exp` validation and earlier-expiry conflict handling, token acquisition/reuse/staleness/nonzero-exit invalidation, unchanged compact JSON, no automatic send replay, and zero token disclosure across success and failure.
4. Add failing skill scenario evaluations for direct messages, terminal and non-terminal tasks, deterministic artifact text selection, submitted/working polling, each terminal state, deadline exhaustion, best-effort cancellation, absent/present context IDs, identity-local context reuse, and untrusted remote content.
5. Reuse the Example 12 ADK service and gateway route; add only the additional caller identities and authorization cases needed for Example 13.
6. Initialize `skills/using-a2a-cli` with the standard skill tooling, remove unused template resources, and write the smallest workflow that passes skill structure and scenario evaluations.
7. Run the provider-free full path through `agentgateway` and the fake ADK model using the downloaded pinned binary—not a mocked process—and prove two-turn context continuation.
8. Install the same skill package in Letta Code and Codex, give each its own credentials, and run the same live ADK request without changing `SKILL.md`.
9. Write the Example 13 README with exact install, identity setup, invocation, continuation, filtered-log, cleanup, and evidence commands.

## Explicit non-goals

- writing or forking another A2A protocol client;
- adopting the Python sample CLI as production-quality tooling;
- adding a native A2A integration separately to every harness;
- turning the client-only tool into a server, proxy, mock agent, or arbitrary command wrapper;
- arbitrary remote URLs, catalogs, service discovery, or model-selected credentials;
- streaming, subscriptions, push notifications, multimodal/file parts, or artifact downloads in the first skill;
- sharing OAuth client credentials or A2A context IDs across harness identities;
- storing remote Agent Card prose in trusted local instructions;
- claiming untested harnesses support the same skill installation or execution mechanism;
- gateway-enforced binding between caller subjects, routes, and context IDs;
- replacing Example 12's ADK service or expanding its in-memory persistence boundary;
- publishing a general-purpose package before the lab proves the workflow.

## Upstream references checked for this plan

- [Official A2A CLI proposal and Agent Skill rationale](https://github.com/a2aproject/A2A/issues/1929)
- [`a2a-rs` standalone client CLI](https://github.com/a2aproject/a2a-rs/tree/a2a-cli-v0.1.11/a2acli)
- [`a2acli` v0.1.11 source contract](https://github.com/a2aproject/a2a-rs/blob/a2a-cli-v0.1.11/a2acli/src/lib.rs)
- [`a2acli` v0.1.11 release assets](https://github.com/a2aproject/a2a-rs/releases/tag/a2a-cli-v0.1.11)
- [Official Python SDK `ClientFactory`](https://github.com/a2aproject/a2a-python/blob/main/src/a2a/client/client_factory.py)
- [Python sample CLI](https://github.com/a2aproject/a2a-samples/tree/main/samples/python/hosts/cli)
- [Agent Skills specification](https://agentskills.io/specification)
