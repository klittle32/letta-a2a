# Letta A2A Lab

An isolated Agent2Agent Protocol playground containing two persistent local Letta agents, an independent deterministic Python A2A agent, a shared A2A 1.0 bridge, and disposable LiteLLM gateway lanes.

Nothing in this stack connects to the production LiteLLM deployment. The only external dependency is the test model provider called by each local Letta runtime.

The completed proof, limits, and observable demo are summarized in [`docs/CONCLUSIONS.md`](docs/CONCLUSIONS.md).

## Architecture

```text
client ──▶ LiteLLM A :4001 ──▶ bridge ──App Server──▶ Agent A
client ──▶ LiteLLM B :4002 ──▶ bridge ──App Server──▶ Agent B
client ──▶ LiteLLM Reference :4003 ──A2A──▶ Python reference agent

Agent A ──a2a_invoke──▶ LiteLLM B ──A2A──▶ Agent B
Agent B ──a2a_invoke──▶ LiteLLM A ──A2A──▶ Agent A
Agent A ──a2a_invoke──▶ LiteLLM Reference ──A2A──▶ Python reference agent
```

The seven services are:

- `agent-a`: Letta Code 0.30.25 App Server with a local backend.
- `agent-b`: an independently persisted local Letta backend.
- `bridge`: exposes a separate Agent Card and A2A endpoint for each Letta runtime, and registers the controller-owned `a2a_invoke` tool on both runtimes.
- `reference-agent`: a non-Letta, non-LLM fixture built with the official Python `a2a-sdk`. Its exact commands exercise echo, context continuity, failure, delay, and cancellation.
- `litellm-a`, `litellm-b`, and `litellm-reference`: identical LiteLLM 1.97.0 gateways, pinned by OCI digest, with config-defined A2A agents and no database.

The separate gateway lanes are deliberate. Live testing showed that an active task routed through one LiteLLM 1.97.0 process could not safely re-enter that same process for a nested A2A send; the caller and callee waited on each other. Routing each target through its own lane breaks that lock cycle while keeping every agent-to-agent hop behind LiteLLM.

Clients also use A2A's asynchronous task mode: `returnImmediately: true`, then `GetTask` polling. The bridge rejects blocking requests that explicitly ask for `a2a_invoke`.

Only the three LiteLLM ports are published to the host. The App Servers, bridge, and reference agent remain on the private Compose network.

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
docker compose logs -f agent-a agent-b bridge reference-agent litellm-a litellm-b litellm-reference
```

The bridge creates `Agent A` and `Agent B` on first startup. Agent identities, conversations, workspaces, and A2A context mappings live in separate named volumes.

## Direct A2A smoke tests

Invoke each agent through LiteLLM:

```bash
node scripts/smoke-a2a.mjs agent-a
node scripts/smoke-a2a.mjs agent-b
node scripts/smoke-a2a.mjs reference-agent "echo REFERENCE_OK"
```

Exercise Agent A → Agent B delegation:

```bash
node scripts/smoke-a2a.mjs agent-a \
  "Use a2a_invoke with target agent-b and message 'Reply with exactly AGENT_B_OK'. Then return only agent-b's answer."
```

Exercise Agent B → Agent A delegation:

```bash
node scripts/smoke-a2a.mjs agent-b \
  "Use a2a_invoke with target agent-a and message 'Reply with exactly AGENT_A_OK'. Then return only agent-a's answer."
```

Exercise Letta → independent Python A2A delegation:

```bash
node scripts/smoke-a2a.mjs agent-a \
  "Use a2a_invoke with target reference-agent and message 'echo LETTA_REFERENCE_OK'. Then return only the reference agent's answer."
```

Set `A2A_CONTEXT_ID=<prior contextId>` to send a follow-up into the same persistent Letta conversation.

Inspect discovery directly:

```bash
curl -sS \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY:-sk-a2a-lab-only}" \
  http://127.0.0.1:4001/a2a/agent-a/.well-known/agent-card.json
```

## Development checks

```bash
bun install
bun test
bun run test:python
bun run check
bun run build
docker compose config --quiet
```

Unit tests cover configuration and gateway-route validation, protocol text mapping, durable A2A-context mappings, Agent Card construction, delegation hop policy, the outbound controller-owned tool request shape, and the reference agent's deterministic command surface.

Run the deterministic protocol matrix without calling a model provider:

```bash
bun run test:protocol
```

Run the full live suite, including a provider-backed Letta tool-use turn:

```bash
bun run test:integration
```

Each invocation uses a unique Compose project and dynamically allocated loopback ports, then removes its containers and volumes. The protocol matrix deterministically proves reference-agent discovery, asynchronous `SendMessage`/`GetTask`, context continuation, terminal failure, and cancellation stability. The full suite adds live Letta Agent A → reference-agent delegation and proves that canceling the outer Letta task cancels its active remote child task. It therefore requires a working provider credential and remains subject to provider and model availability. The ordinary lab can remain running. Set `A2A_INTEGRATION_NO_MANAGE=1` to run the same assertions against an already-running lab on ports `4001` and `4003`.

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

- A2A 1.0 JSON-RPC is the client-facing target. The bridge also advertises the SDK's 0.3 compatibility interface because LiteLLM 1.97.0 forwards task methods without preserving the `A2A-Version` header.
- Text input and text artifacts are implemented first.
- Streaming is not advertised yet; the bridge currently publishes one final text artifact per Letta turn.
- Active task state uses each A2A SDK's in-memory task store. Letta conversation mappings survive bridge restarts, but historical `GetTask` records do not yet. The reference agent intentionally loses tasks and context memory on restart.
- Push notifications, file parts, authenticated upstream Agent Cards, and production multi-tenant caller identity are intentionally deferred.
- Each conversation permits one active Letta turn. Concurrent messages to one A2A context are serialized.
- Delegation is opt-in per turn: the request must explicitly mention `a2a_invoke`. Nested calls carry a hop count, and `MAX_A2A_HOPS=1` prevents accidental agent ping-pong loops. The caller-supplied hop metadata is a loop guard, not an authentication boundary.
- Canceling an outer Letta task aborts active outbound A2A polling, sends a bounded best-effort `CancelTask` to an accepted remote child, and then aborts the local App Server turn. Tasks canceled while waiting on a conversation lock never start a Letta runtime.
- Letta turns run in `unrestricted` permission mode because the headless App Server has no human approval channel. The per-turn allowlist is empty for ordinary calls and contains only the scoped, controller-owned `a2a_invoke` tool for explicit delegation requests.
- Default credentials are fixed lab-only values and both gateway ports bind to loopback. Do not reuse this Compose file unchanged for a shared or production environment.

These boundaries keep the experiment focused on discovery, gateway routing, persistent conversation continuity, cancellation, genuine bidirectional Letta delegation, and cross-language interoperability with an independently deployed agent built on the official Python A2A SDK.
