# 05 — External A2A Agent to Letta

## What this teaches

An independently implemented A2A agent can initiate work against a Letta agent without using Letta-specific APIs. It discovers Letta through an Agent Card, follows the asynchronous A2A task lifecycle, and returns Letta's artifact to its own caller.

The reference agent uses the official Python `a2a-sdk==1.1.2` client. Its `ask-letta` command is intentionally narrow so the protocol flow stays visible.

Executed verification is retained in [`docs/evidence/2026-09-03-example-05.md`](../../docs/evidence/2026-09-03-example-05.md).

## Message flow

```text
client
  └──▶ agentgateway ──▶ external reference agent
                          └── GET Agent A card ──▶ agentgateway ──▶ bridge
                          └── SendMessage ───────▶ agentgateway ──▶ Agent A
                          └── GetTask polling ───▶ agentgateway ──▶ bridge
                          ◀── completed Letta artifact
       ◀── external agent's completed artifact
```

Both directions cross the same shared gateway process. The external agent never connects to the Letta App Server directly.

## Run it

Start the shared lab:

```bash
docker compose up --build -d
```

Ask the external agent to delegate to Letta:

```bash
node scripts/smoke-a2a.mjs reference-agent \
  "ask-letta Reply with exactly EXTERNAL_TO_LETTA_OK and nothing else."
```

## Expected result

The outer reference-agent task completes with a text artifact containing:

```text
EXTERNAL_TO_LETTA_OK
```

In this demonstrated path there are two A2A tasks: the outer task addressed to the external agent and the child task addressed to Agent A. The smoke client's final JSON contains the outer task.

## Watch it happen

```bash
docker compose logs -f --since=0s \
  agentgateway reference-agent bridge agent-a
```

Agentgateway's structured request lines show the outer `reference-agent` route followed by Agent Card discovery and task operations on the `agent-a` route. The live integration suite also prints:

```text
✓ independent reference agent to Letta Agent A delegation
```

## What the controller is doing

The reference agent recognizes `ask-letta TEXT` as a controller command. For each invocation it:

1. Fetches Agent A's proxied Agent Card with `A2ACardResolver`.
2. Verifies that the discovered identity is `Agent A`.
3. Creates a JSON-RPC client with `ClientFactory`.
4. Sends `SendMessage` with `returnImmediately: true`.
5. Marks the request as delegation hop `1`, preventing another nested delegation under the lab's default hop limit.
6. Polls `GetTask` until the task completes, fails, is canceled/rejected, or requires input/authentication the fixed command cannot provide.
7. Returns a completed text artifact, or fails the outer task with the remote state and detail.

This is controller code around the external agent, not behavior hidden in an LLM prompt.

## Boundaries

- Agent A's answer is model-backed, so the exact marker is a live assertion rather than a deterministic fixture.
- The external agent has one fixed outbound target: Agent A through the configured gateway URL.
- Only text input and text artifacts are mapped.
- Canceling or timing out the outer reference-agent call stops its local outbound client, and cancellation leaves the outer task stably canceled. Neither path yet sends `CancelTask` to an accepted Letta child. The existing nested-cancellation proof covers the opposite direction, where Letta is the outer task.
- Any child state other than completed—including failed, canceled, rejected, input-required, or auth-required—becomes a failed outer task with the child state and available detail.
- The gateway key is supplied out of band. [Example 06](../06-static-bearer-auth/) aligns that enforced authentication with the Agent Cards' advertised security declarations.
