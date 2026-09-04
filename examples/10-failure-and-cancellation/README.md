# 10 — Failure and Cancellation

## What this teaches

A2A tasks have explicit terminal states. Failure and cancellation are protocol outcomes, not text conventions hidden inside a successful response.

This example also demonstrates nested cancellation: canceling a Letta task propagates to the active remote child task.

## Message flow

```text
Direct failure:
client ──SendMessage──▶ external agent ──▶ TASK_STATE_FAILED

Nested cancellation:
client ──CancelTask──▶ Letta outer task
                         └──CancelTask──▶ external child task
client ◀──────────── both tasks remain TASK_STATE_CANCELED
```

## Run it

Observe a deterministic failure directly:

```bash
test -f .env || cp .env.example .env
nvim .env
set -a
source .env
set +a
docker compose up --build -d --wait

if output=$(node scripts/smoke-a2a.mjs reference-agent \
  "fail EXPECTED_FAILURE" 2>&1); then
  echo "Expected the A2A task to fail" >&2
  exit 1
fi

printf '%s\n' "$output" | grep "A2A task failed: EXPECTED_FAILURE"
```

The wrapper treats the client's nonzero exit as the expected result and verifies its failure detail.

Run the provider-free lifecycle matrix, which includes direct failure and cancellation stability:

```bash
bun run test:protocol
```

Run the live nested-cancellation proof:

```bash
bun run test:integration
```

To run the same assertions against the ordinary lab while following its logs in another terminal:

```bash
A2A_INTEGRATION_NO_MANAGE=1 node scripts/integration-a2a.mjs
```

## Expected result

The direct failure reports:

```text
A2A task failed: EXPECTED_FAILURE
```

The deterministic matrix includes:

```text
✓ terminal failure propagation
✓ deterministic cancellation remains terminal
```

The live suite additionally includes:

```text
✓ outer cancellation propagates to the remote child task
```

## Watch it happen

Against the ordinary lab, start this first:

```bash
docker compose logs -f --since=0s \
  agentgateway bridge agent-a reference-agent
```

Managed integration runs use their own temporary Compose project and print its logs automatically when an assertion fails.

## What the controller is doing

The outbound A2A client retains the accepted child task ID. If the outer Letta turn is canceled, it stops polling and sends a bounded best-effort remote `CancelTask`. The bridge aborts the Letta runtime and keeps the conversation lock until the runtime terminates or reaches a bounded fallback.

Timeout cleanup follows the same remote-cancellation path and is covered by unit tests; the live demonstration specifically proves user-triggered outer cancellation.

A first-winner terminal claim prevents cancellation, completion, and failure from overwriting one another.

## Boundaries

- Remote cancellation is best effort because a transport failure can prevent delivery.
- The live nested test requires a working model provider and may fail if the model does not select the explicitly requested tool.
- Task records use in-memory A2A SDK stores and do not survive service recreation.
