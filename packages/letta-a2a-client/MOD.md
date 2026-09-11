# letta-a2a-client

## Purpose

Give local Letta Code agents one typed `a2a_invoke` tool backed by the official TypeScript A2A client.

## Behavior

- Discovers configured A2A 1.0 Agent Cards and uses their JSON-RPC interface.
- Sends work asynchronously, then polls the task to a terminal state.
- Propagates local cancellation to an accepted remote task on a best-effort basis.
- Associates each local Letta conversation and target with its last remote A2A context so follow-up calls continue naturally.
- Returns compact JSON containing the target, outcome, task ID, context ID, and remote text.

## Entry points

- `dist/a2a-client.mjs` (bundled from `mods/a2a-client.ts`)

## Safety

The mod can contact only routes explicitly listed in its local configuration. It rejects credentials embedded in route URLs and never stores credentials in its context map. The tool does not require a local approval because it is intended for autonomous agent delegation; policy and approval for any consequential action remain the responsibility of the receiving agent.

Mods are trusted local code and run with the user's permissions. Review the source and configure only trusted A2A endpoints.
