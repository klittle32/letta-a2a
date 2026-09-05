# Letta A2A Lab

An isolated Agent2Agent Protocol playground containing two persistent local Letta agents, independent Python A2A implementations, a shared TypeScript A2A bridge, local OAuth and webhook fixtures, one agentgateway proxy, and an optional Hermes client harness.

The seven-service core and two Example 12 services run in Docker on one host. The deterministic protocol paths are provider-free; live Letta, Hermes, and Google ADK turns additionally require the configured model provider.

The completed proof and limits are summarized in [`docs/CONCLUSIONS.md`](docs/CONCLUSIONS.md). The numbered demonstrations and implementation roadmap live in [`examples/README.md`](examples/README.md).

## Architecture

```text
client ──client credentials──▶ authorization server :9001
       ◀──── short-lived JWT ─────────────────────────────┘

client ──JWT──▶ agentgateway :4000 ──┬──▶ bridge ──App Server──▶ Agent A
                               ├──▶ bridge ──App Server──▶ Agent B
                               ├──A2A──▶ Python reference agent
                               └──A2A──▶ Google ADK agent (Example 12 profile)

Agent A ──a2a_invoke──▶ agentgateway ──A2A──▶ Agent B
Agent B ──a2a_invoke──▶ agentgateway ──A2A──▶ Agent A
Agent A ──a2a_invoke──▶ agentgateway ──A2A──▶ Python reference agent
Python reference agent ──official A2A client──▶ agentgateway ──A2A──▶ Agent A

bridge / reference agent ──Bearer callback──▶ webhook receiver :8100

operator ──TTY──▶ Hermes TUI ──built-in a2a_call + JWT──▶ agentgateway
shell-capable agent ──using-a2a-cli skill──▶ installed a2acli ──▶ agentgateway
```

The seven core services are:

- `agent-a`: Letta Code 0.30.25 App Server with a local backend.
- `agent-b`: an independently persisted local Letta backend.
- `bridge`: exposes a separate Agent Card and A2A endpoint for each Letta runtime, and registers the controller-owned `a2a_invoke` tool on both runtimes.
- `reference-agent`: a non-Letta, non-LLM fixture built with the official Python `a2a-sdk`. Its exact commands exercise echo, ordered streaming, context continuity, failure, delay, and cancellation; one narrow outbound command delegates to Agent A.
- `auth-server`: a local-only OAuth client-credentials fixture with short-lived RSA-signed JWTs, metadata, and JWKS endpoints.
- `agentgateway`: one agentgateway v1.5.0 process, pinned by OCI digest, with path-based A2A routes, strict JWT authentication, caller-aware role/scope authorization, Agent Card rewriting, structured A2A logs, and a loopback UI.
- `webhook-receiver`: a test-only authenticated callback ledger with an authenticated observation endpoint published only on host loopback.

Example 12 adds two profile-gated services:

- `google-adk-agent`: a minimal Google ADK 2.8.0 `to_a2a()` agent with one text skill, in-memory sessions, an OAuth-declaring A2A 1.0 card, provider-free fake model, and opt-in live LiteLLM model.
- `hermes-tui`: the official Hermes Agent v0.21.0 image pinned by release and OCI digest, with the stock outbound A2A toolset, a dedicated state volume, short-lived OAuth launcher, and no inbound A2A listener.

The shared gateway is deliberate. The unchanged core discovery, messaging, context, delegation, failure, and cancellation matrix proved that nested calls can safely re-enter one agentgateway process. This replaces the three-process lane workaround previously required by LiteLLM 1.97.0. See [`docs/GATEWAY_DECISION.md`](docs/GATEWAY_DECISION.md).

Nested outbound clients use A2A's asynchronous task mode: `returnImmediately: true`, then `GetTask` polling. External clients may use the same lifecycle, inbound `SendStreamingMessage`, or an authenticated push callback. Requests whose text contains `a2a_invoke` must use asynchronous mode.

Only the OAuth, A2A gateway, UI, and callback-fixture ports are published to host loopback. The App Servers, bridge, and reference agent remain on the private Compose network.

## Prerequisites

- Docker with Compose for the lab services.
- Bun, Node.js `>=24.19.0`, and `uv` for local development and test commands. `uv` provisions the reference agent's Python `>=3.13` environment.
- `curl` and `jq` for the copyable protocol walkthroughs under [`examples/`](examples/README.md).

## Start the lab

```bash
test -f .env || cp .env.example .env
nvim .env
docker compose up --build -d --wait
docker compose ps
```

`OPENAI_API_KEY` is the only value without a working local default. `LETTA_TEST_MODEL` defaults to `openai/gpt-4.1-nano`; change it if that handle is not available to the supplied account. The remaining values in `.env.example` control lab-only credentials, published ports, token lifetime, turn timeout, and hop limit.

The OAuth host port defaults to `9001` because local PHP-FPM installations commonly occupy `9000`. If Compose reports another bind conflict, change the corresponding published port in `.env`; container-internal ports remain unchanged.

Watch startup:

```bash
docker compose logs -f auth-server agent-a agent-b bridge reference-agent agentgateway webhook-receiver
```

The bridge ensures `Agent A` and `Agent B` exist, creating either one only when absent. Each Letta runtime has separate state and workspace volumes; A2A-to-Letta context mappings use the shared `bridge-state` volume and remain keyed by agent.

## Examples

Follow the numbered learning path in [`examples/`](examples/README.md). The ready examples cover:

- `01` — [Agent discovery](examples/01-agent-discovery/)
- `02` — [Basic messaging across two implementations](examples/02-basic-messaging/)
- `03` — [Context continuation](examples/03-context-continuation/)
- `04` — [Letta delegating to an external A2A agent](examples/04-letta-to-external-a2a-agent/)
- `05` — [An external A2A agent delegating to Letta](examples/05-external-a2a-agent-to-letta/)
- `06` — [Static Bearer authentication](examples/06-static-bearer-auth/)
- `07` — [OAuth client credentials](examples/07-oauth-client-credentials/)
- `08` — [Authorization policy](examples/08-authorization-policy/)
- `09` — [Streaming](examples/09-streaming/)
- `10` — [Failure and cancellation](examples/10-failure-and-cancellation/)
- `11` — [Push notifications](examples/11-push-notifications/)
- `12` — [Hermes TUI to Google ADK](examples/12-hermes-tui-to-google-adk/)
- `13` — [Portable A2A CLI skill](examples/13-a2a-cli-skill/)

Implemented examples are complete through Example 13. Examples 06–08 retain exact historical checkpoints because later stages intentionally replaced their security policy. Polling walkthroughs reuse `scripts/smoke-a2a.mjs`, streaming uses `curl -N` and the integration client's SSE parser, and Example 12 adds a separate profile-gated ADK/Hermes path.

## Development checks

```bash
bun install --frozen-lockfile
(cd services/reference-agent && uv sync --frozen)
(cd services/google-adk-agent && uv sync --frozen)
bun test
bun run test:python
bun run check
bun run build
bun run test:compose
```

Unit tests cover configuration and gateway-route validation, OAuth issuance and token caching, protocol text mapping, safe Letta stream projection, ordered artifact publication, push registration and delivery policy, duplicate-safe callback receipt, durable A2A-context mappings, Agent Card construction, delegation hop policy, both outbound A2A client paths, and the reference agent's deterministic command surface.

Run the deterministic protocol matrix without calling a model provider:

```bash
bun run test:protocol
bun run test:example-12
```

Run the full live suite, including a provider-backed Letta tool-use turn:

```bash
bun run test:integration
bun run test:example-12:live
```

Each invocation uses a unique Compose project and dynamically allocated loopback ports, then removes its containers and volumes. The protocol matrix first proves authentication and caller-aware authorization, then exercises Agent Card discovery, authenticated duplicate-safe reference-agent push delivery, ordered SSE chunks, stream failure, disconnect persistence, asynchronous `SendMessage`/`GetTask`, context continuation, terminal failure, and cancellation stability. The full suite adds the corresponding Letta push path, safe Letta assistant-text streaming, live delegation in both directions through separate bridge and reference-agent identities, and outer-to-child cancellation. It requires a working provider credential and remains subject to provider and model availability. The ordinary lab can remain running. Set `A2A_INTEGRATION_NO_MANAGE=1` to run the core assertions against an already-running lab on ports `4000`, `9001`, and `8100`; only the stale-token probe requires the managed integration fixture.

Example 13 is intentionally just installation instructions plus a small skill that teaches an agent to use the official `a2acli`. See [`examples/13-a2a-cli-skill/`](examples/13-a2a-cli-skill/).

The Example 12 provider-free check uses its real ADK/A2A containers with a fake model and a dedicated Hermes OAuth identity, but does not start Hermes. Its opt-in live check invokes the stock Hermes `a2a_call` tool twice against a live ADK model and verifies Hermes audit plus gateway/ADK correlation. The interactive TUI walkthrough remains under [`examples/12-hermes-tui-to-google-adk/`](examples/12-hermes-tui-to-google-adk/).

## Persistence and reset

Ordinary restart preserves the volume-backed agents, conversations, workspaces, and bridge context mappings:

```bash
docker compose restart
```

Restarting the bridge or reference agent loses that service's in-memory A2A task records and push registrations. Restarting the reference agent also loses its deterministic context memory; restarting the webhook receiver loses its observation ledger.

Stop without deleting persistent volume state:

```bash
docker compose down
```

Completely reset the playground:

```bash
docker compose down --volumes
```

The reset command additionally deletes both local Letta agents, their conversations and workspaces, and the bridge's persisted A2A context mappings. Process-local reference-agent and webhook-receiver state was already lost when their containers stopped.

## Current boundaries

- A2A 1.0 JSON-RPC is the tested client-facing target. The backends retain a 0.3 compatibility interface for broader client compatibility; agentgateway v1.5.0 does not itself parse or enforce `A2A-Version` or prove complete 1.0 conformance.
- Text input and text artifacts are implemented first.
- Both agent implementations advertise A2A streaming over SSE. The bridge publishes only top-level Letta assistant text as ordered artifact chunks; reasoning, tool, command, subagent, and unknown runtime events remain private.
- Both agent implementations advertise push notifications, and the demonstrated registration and delivery flow uses A2A 1.0. Registration accepts only the exact configured lab callback and Bearer credential; callbacks are best effort, in memory, redirect-free, and duplicate-safe for identical payloads at the receiver. `GetTask` remains authoritative.
- Active task state uses each A2A SDK's in-memory task store. Letta conversation mappings survive bridge restarts, but historical `GetTask` records do not yet. The reference agent intentionally loses tasks and context memory on restart.
- Signed Agent Cards and production multi-tenant caller identity are deferred. Binary file transfer is deliberately out of scope for this reference repository.
- Each conversation permits one active Letta turn. Concurrent messages to one A2A context are serialized.
- Delegation is opt-in per turn: the request must explicitly mention `a2a_invoke`. Nested calls carry a hop count, and `MAX_A2A_HOPS=1` prevents accidental agent ping-pong loops. Missing, malformed, fractional, or negative hop metadata normalizes to zero; this is a loop guard, not an authentication boundary.
- Canceling an outer Letta task aborts active outbound A2A polling, sends a bounded best-effort `CancelTask` to an accepted remote child, and then aborts the local App Server turn. Tasks canceled while waiting on a conversation lock never start a Letta runtime.
- Letta turns run in `unrestricted` permission mode because the headless App Server has no human approval channel. The per-turn allowlist is empty for ordinary calls and contains only the scoped, controller-owned `a2a_invoke` tool for explicit delegation requests.
- The A2A listener validates short-lived OAuth JWTs against the local authorization server's issuer, audience, and JWKS. Agent Card discovery requires `a2a.discover`; JSON-RPC invocation requires `a2a.invoke` plus an issuer-assigned `operator` or `agent` role.
- Agentgateway emits useful A2A telemetry to structured stdout. Its UI log search returned no stored A2A rows during evaluation, so this lab does not treat the UI as an A2A audit store.
- The shell operator, bridge, reference agent, OAuth observer, and denied invoker use distinct disposable identities. The denied invoker intentionally has `a2a.invoke` but an untrusted role, proving that scope possession alone does not authorize a request. Push delivery and receiver observation use two additional fixed lab-only Bearer credentials.
- The authorization server is an in-memory test fixture, and the lab uses plain HTTP on host loopback and its private Compose network. Default credentials are fixed lab-only values. Do not reuse this Compose file unchanged for a shared or production environment.

These boundaries keep the experiment focused on discovery, gateway routing, ordered streaming, authenticated asynchronous notification, persistent conversation continuity, cancellation, genuine bidirectional Letta delegation, and cross-language interoperability with an independently deployed agent built on the official Python A2A SDK.
