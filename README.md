# Letta A2A Lab

An isolated Agent2Agent Protocol playground containing two persistent local Letta agents, an independent deterministic Python A2A agent, a shared A2A 1.0 bridge, and one agentgateway proxy.

The only external runtime dependency is the test model provider called by each local Letta runtime.

The completed proof and limits are summarized in [`docs/CONCLUSIONS.md`](docs/CONCLUSIONS.md). The numbered demonstrations and implementation roadmap live in [`examples/README.md`](examples/README.md).

## Architecture

```text
client ──▶ agentgateway :4000 ──┬──▶ bridge ──App Server──▶ Agent A
                               ├──▶ bridge ──App Server──▶ Agent B
                               └──A2A──▶ Python reference agent

Agent A ──a2a_invoke──▶ agentgateway ──A2A──▶ Agent B
Agent B ──a2a_invoke──▶ agentgateway ──A2A──▶ Agent A
Agent A ──a2a_invoke──▶ agentgateway ──A2A──▶ Python reference agent
Python reference agent ──official A2A client──▶ agentgateway ──A2A──▶ Agent A
```

The five services are:

- `agent-a`: Letta Code 0.30.25 App Server with a local backend.
- `agent-b`: an independently persisted local Letta backend.
- `bridge`: exposes a separate Agent Card and A2A endpoint for each Letta runtime, and registers the controller-owned `a2a_invoke` tool on both runtimes.
- `reference-agent`: a non-Letta, non-LLM fixture built with the official Python `a2a-sdk`. Its exact commands exercise echo, context continuity, failure, delay, and cancellation; one narrow outbound command delegates to Agent A.
- `agentgateway`: one agentgateway v1.5.0 process, pinned by OCI digest, with path-based A2A routes, strict lab-key authentication, Agent Card rewriting, structured A2A logs, and a loopback UI.

The shared gateway is deliberate. The unchanged protocol and live cancellation matrix proved that nested calls can safely re-enter one agentgateway process. This replaces the three-process lane workaround previously required by LiteLLM 1.97.0. See [`docs/GATEWAY_DECISION.md`](docs/GATEWAY_DECISION.md).

Clients also use A2A's asynchronous task mode: `returnImmediately: true`, then `GetTask` polling. The bridge rejects blocking requests that explicitly ask for `a2a_invoke`.

Only the A2A gateway and UI ports are published to host loopback. The App Servers, bridge, and reference agent remain on the private Compose network.

## Start the lab

```bash
cp .env.example .env
nvim .env
docker compose up --build -d
docker compose ps
```

`OPENAI_API_KEY` is required. `LETTA_TEST_MODEL` defaults to `openai/gpt-4.1-nano`; change it if that handle is not available to the supplied account.

Watch startup:

```bash
docker compose logs -f agent-a agent-b bridge reference-agent agentgateway
```

The bridge creates `Agent A` and `Agent B` on first startup. Agent identities, conversations, workspaces, and A2A context mappings live in separate named volumes.

## Examples

Follow the numbered learning path in [`examples/`](examples/README.md). The ready examples cover:

- `01` — [Agent discovery](examples/01-agent-discovery/)
- `02` — [Basic messaging across two implementations](examples/02-basic-messaging/)
- `03` — [Context continuation](examples/03-context-continuation/)
- `04` — [Letta delegating to an external A2A agent](examples/04-letta-to-external-a2a-agent/)
- `05` — [An external A2A agent delegating to Letta](examples/05-external-a2a-agent-to-letta/)
- `10` — [Failure and cancellation](examples/10-failure-and-cancellation/)

Every example uses this shared Compose stack and the reusable client in `scripts/smoke-a2a.mjs`. Planned examples appear only in the index until their behavior and documentation are ready.

## Development checks

```bash
bun install
bun test
bun run test:python
bun run check
bun run build
docker compose config --quiet
```

Unit tests cover configuration and gateway-route validation, protocol text mapping, durable A2A-context mappings, Agent Card construction, delegation hop policy, both outbound A2A client paths, and the reference agent's deterministic command surface.

Run the deterministic protocol matrix without calling a model provider:

```bash
bun run test:protocol
```

Run the full live suite, including a provider-backed Letta tool-use turn:

```bash
bun run test:integration
```

Each invocation uses a unique Compose project and dynamically allocated loopback ports, then removes its containers and volumes. The protocol matrix deterministically proves reference-agent discovery, asynchronous `SendMessage`/`GetTask`, context continuation, terminal failure, and cancellation stability. The full suite adds live delegation in both directions between Letta Agent A and the reference agent, then proves that canceling an outer Letta task cancels its active remote child task. It therefore requires a working provider credential and remains subject to provider and model availability. The ordinary lab can remain running. Set `A2A_INTEGRATION_NO_MANAGE=1` to run the same assertions against an already-running lab on port `4000`.

## Persistence and reset

Ordinary restart preserves both agents and their conversations:

```bash
docker compose restart
```

Stop without deleting state:

```bash
docker compose down
```

Completely reset the playground:

```bash
docker compose down --volumes
```

The reset command permanently deletes both local agents, all lab conversations, and the reference agent's process-local test memory.

## Current boundaries

- A2A 1.0 JSON-RPC is the tested client-facing target. The backends retain a 0.3 compatibility interface for broader client compatibility; agentgateway v1.5.0 does not itself parse or enforce `A2A-Version` or prove complete 1.0 conformance.
- Text input and text artifacts are implemented first.
- Streaming is not advertised yet; the bridge currently publishes one final text artifact per Letta turn.
- Active task state uses each A2A SDK's in-memory task store. Letta conversation mappings survive bridge restarts, but historical `GetTask` records do not yet. The reference agent intentionally loses tasks and context memory on restart.
- Push notifications, authenticated upstream Agent Cards, and production multi-tenant caller identity are deferred. Binary file transfer is deliberately out of scope for this reference repository.
- Each conversation permits one active Letta turn. Concurrent messages to one A2A context are serialized.
- Delegation is opt-in per turn: the request must explicitly mention `a2a_invoke`. Nested calls carry a hop count, and `MAX_A2A_HOPS=1` prevents accidental agent ping-pong loops. The caller-supplied hop metadata is a loop guard, not an authentication boundary.
- Canceling an outer Letta task aborts active outbound A2A polling, sends a bounded best-effort `CancelTask` to an accepted remote child, and then aborts the local App Server turn. Tasks canceled while waiting on a conversation lock never start a Letta runtime.
- Letta turns run in `unrestricted` permission mode because the headless App Server has no human approval channel. The per-turn allowlist is empty for ordinary calls and contains only the scoped, controller-owned `a2a_invoke` tool for explicit delegation requests.
- The A2A listener enforces a fixed lab-only API key. That policy is not yet declared in the proxied backend Agent Cards; aligning advertised security is a later example.
- Agentgateway emits useful A2A telemetry to structured stdout. Its UI log search returned no stored A2A rows during evaluation, so this lab does not treat the UI as an A2A audit store.
- Default credentials are fixed lab-only values and both published ports bind to loopback. Do not reuse this Compose file unchanged for a shared or production environment.

These boundaries keep the experiment focused on discovery, gateway routing, persistent conversation continuity, cancellation, genuine bidirectional Letta delegation, and cross-language interoperability with an independently deployed agent built on the official Python A2A SDK.
