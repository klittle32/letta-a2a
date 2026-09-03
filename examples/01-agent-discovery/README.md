# 01 — Agent Discovery

## What this teaches

An A2A client learns how to contact an agent by reading its Agent Card. Discovery describes the agent; it does not start a task or invoke a model.

This example compares a Letta-backed agent with an independently implemented A2A agent through the same discovery mechanism.

## Message flow

```text
client ──GET /a2a/agent-a/...──────────▶ LiteLLM lane :4001
client ──GET /a2a/reference-agent/...──▶ LiteLLM lane :4003
```

All three LiteLLM processes load the same agent catalog. Using a target-specific lane is a routing convention that prevents nested calls from re-entering the gateway process handling the outer task; it is not a different catalog per lane.

## Run it

Start the shared lab from the repository root:

```bash
docker compose up --build -d
docker compose ps
```

Fetch the Letta agent's card:

```bash
curl -sS \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY:-sk-a2a-lab-only}" \
  http://127.0.0.1:4001/a2a/agent-a/.well-known/agent-card.json \
  | jq
```

Fetch the external agent's card:

```bash
curl -sS \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY:-sk-a2a-lab-only}" \
  http://127.0.0.1:4003/a2a/reference-agent/.well-known/agent-card.json \
  | jq
```

## Expected result

The cards should identify `Agent A` and `Independent Reference Agent`, provide their gateway invocation URLs, and advertise protocol version `1.0`. No task or context ID is created.

## Watch it happen

```bash
docker compose logs -f --since=0s litellm-a litellm-reference bridge reference-agent
```

The gateway logs show Agent Card requests, but neither backend agent starts a task.

## What the controller is doing

LiteLLM publishes a small config-defined card for each target and rewrites the public invocation URL to its own gateway path. The request does not need to reach the Letta bridge or external agent.

## Boundaries

- The two card locations are configured rather than found through a dynamic registry.
- The current gateway cards are intentionally minimal: name, description, invocation URL, and protocol version. They do not yet expose the richer capabilities, skills, or security declarations available in the backend cards.
- The Bearer value in these commands is an out-of-band LiteLLM gateway key; the current cards do not declare it as an A2A security scheme. Later examples add aligned authentication declarations and enforcement.
- A2A 0.3 compatibility is also advertised because of a known LiteLLM forwarding limitation, but the client-facing target is A2A 1.0.
