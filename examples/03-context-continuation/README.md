# 03 — Context Continuation

## What this teaches

An A2A `contextId` groups related messages and tasks. A client treats it as an opaque value returned by the server and sends it back when continuing the interaction.

## Message flow

```text
client ──remember CONTEXT_OK────────────▶ external agent
client ◀─task + contextId──────────────── external agent
client ──context + same contextId────────▶ external agent
client ◀─artifact: CONTEXT_OK───────────── external agent
```

## Run it

Start the shared lab, then save the context returned by the first task:

```bash
test -f .env || cp .env.example .env
nvim .env
set -a
source .env
set +a
docker compose up --build -d --wait

context_id=$(
  node scripts/smoke-a2a.mjs reference-agent \
    "remember CONTEXT_OK" \
  | jq -r '.result.task.contextId'
)

echo "$context_id"
```

The `jq` expression reads the wrapper printed by this repository's smoke client. The A2A value of interest inside that output is the task's opaque `contextId`.

Continue that context:

```bash
A2A_CONTEXT_ID="$context_id" \
  node scripts/smoke-a2a.mjs reference-agent "context"
```

## Expected result

The second task has the same `contextId` and returns:

```text
CONTEXT_OK
```

It receives a new task ID because it is new work within the existing context.

## Watch it happen

```bash
docker compose logs -f --since=0s agentgateway reference-agent
```

## What the controller is doing

The external fixture stores its deterministic memory by A2A context ID. On the Letta side, the bridge instead persists a mapping from the opaque A2A context ID to the corresponding Letta conversation ID. The client does not need to know that internal ID.

## Boundaries

- The reference agent's context memory is process-local and disappears when its container is recreated.
- Letta conversations and bridge context mappings use Docker volumes and survive ordinary restarts.
- A context groups interactions; it is not the same thing as a task, credential, or authorization boundary.
