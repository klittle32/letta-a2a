# 01 — Agent Discovery

## What this teaches

An A2A client learns how to contact an agent by reading its Agent Card. Discovery describes the agent; it does not start a task or invoke a model.

This example compares a Letta-backed agent with an independently implemented A2A agent through the same discovery mechanism.

## Message flow

```text
client ──GET /a2a/agent-a/...──────────▶ agentgateway :4000 ──▶ bridge
client ──GET /a2a/reference-agent/...──▶ agentgateway :4000 ──▶ external agent
```

One agentgateway process routes each public path to the corresponding backend and rewrites the backend card's interface URLs to the client-visible gateway path.

## Run it

Start the shared lab from the repository root:

```bash
docker compose up --build -d
docker compose ps
```

Fetch the Letta agent's card:

```bash
curl -sS \
  -H "Authorization: Bearer ${A2A_GATEWAY_KEY:-sk-a2a-lab-only}" \
  http://127.0.0.1:4000/a2a/agent-a/.well-known/agent-card.json \
  | jq
```

Fetch the external agent's card:

```bash
curl -sS \
  -H "Authorization: Bearer ${A2A_GATEWAY_KEY:-sk-a2a-lab-only}" \
  http://127.0.0.1:4000/a2a/reference-agent/.well-known/agent-card.json \
  | jq
```

## Expected result

The cards should identify `Agent A` and `Independent Reference Agent`, advertise their capabilities and skills, and provide A2A 1.0 interface URLs under `http://127.0.0.1:4000/a2a/...`. No task or context ID is created.

## Watch it happen

```bash
docker compose logs -f --since=0s agentgateway bridge reference-agent
```

The gateway logs show Agent Card requests, but neither backend agent starts a task.

## What the controller is doing

Each backend constructs its own Agent Card. Agentgateway proxies that card and rewrites its interface URLs to the public route while preserving the backend's capabilities and skills.

## Boundaries

- The two card locations are configured rather than found through a dynamic registry.
- Agentgateway strictly enforces the Bearer value in these commands, but the proxied backend cards do not yet declare that gateway policy as an A2A security scheme. Later examples align declarations and enforcement.
- A2A 0.3 compatibility is also advertised for broader clients, but the tested client-facing target is A2A 1.0.
