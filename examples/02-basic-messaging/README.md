# 02 — Basic Messaging

## What this teaches

One A2A client can call agents implemented with different runtimes. Both calls use the same asynchronous task lifecycle: `SendMessage`, a returned task ID, `GetTask` polling, and a final artifact.

## Message flow

```text
client ──lane :4001, target agent-a──────────▶ bridge ──▶ Letta App Server
client ──lane :4003, target reference-agent──▶ independent A2A agent
```

Each LiteLLM lane loads the same target catalog. The client deliberately chooses a different gateway process for each target so a nested delegation never re-enters the process serving its outer request.

## Run it

Start the shared lab:

```bash
docker compose up --build -d
```

Call the Letta agent:

```bash
node scripts/smoke-a2a.mjs agent-a \
  "Reply with exactly BASIC_LETTA_OK"
```

Call the external agent with the same client:

```bash
node scripts/smoke-a2a.mjs reference-agent \
  "echo BASIC_EXTERNAL_OK"
```

## Expected result

Each command prints an Agent Card summary and a completed task. The final artifacts contain:

```text
BASIC_LETTA_OK
BASIC_EXTERNAL_OK
```

The `task.id`, `contextId`, message ID, and artifact ID are generated per request and must be treated as opaque values.

## Watch it happen

```bash
docker compose logs -f --since=0s \
  litellm-a litellm-reference bridge agent-a reference-agent
```

The Letta path starts a Letta App Server runtime. The external path is handled directly by the independent A2A server. Both look the same to the client.

## What the controller is doing

For the Letta request, the bridge maps the incoming A2A message into a Letta turn, collects the final assistant text, and publishes it as an A2A artifact. The external agent owns its task lifecycle directly through the Python A2A SDK.

## Boundaries

- The external agent's `echo` result is deterministic.
- The Letta response is a live model-backed demonstration and depends on provider availability and instruction following.
- This example polls for completion; streaming is introduced later.
