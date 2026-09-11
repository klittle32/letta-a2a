# Letta A2A client mod

A packaged Letta Code mod that registers one model-callable `a2a_invoke` tool using the official `@a2a-js/sdk` client.

## Install locally

From the repository root:

```bash
letta install ./packages/letta-a2a-client
```

Run `/reload` in active Letta Code sessions after installing or updating it.

If the package is installed without valid route configuration, the tool remains visible and returns the startup configuration error. This makes the repair path discoverable without permitting any network request.

## Configure routes

Create `~/.letta/a2a-client.json`:

```json
{
  "routes": {
    "local-example": "http://127.0.0.1:41241"
  },
  "pollIntervalMs": 500,
  "timeoutMs": 120000
}
```

Route names may contain letters, digits, dots, underscores, and hyphens. Route URLs must use HTTP or HTTPS and cannot contain credentials, query strings, or fragments.

For temporary configuration, `LETTA_A2A_ROUTES` may contain the routes object as JSON. `LETTA_A2A_CONFIG` and `LETTA_A2A_CONTEXT_STORE` override the default configuration and context-store paths.

## Tool contract

```text
a2a_invoke(
  target: string,
  message: string,
  context_id?: string,
  new_context?: boolean
)
```

Normally provide only `target` and `message`. The mod stores the returned remote context under:

```text
local agent ID + local conversation ID + target
```

Later calls from that Letta conversation to the same target automatically continue the remote context. Set `new_context: true` to begin a new remote conversation or provide `context_id` to select one explicitly.

Successful calls return compact JSON:

```json
{"target":"local-example","ok":true,"status":"completed","taskId":"...","contextId":"...","text":"remote answer"}
```

Remote failures and interrupted states become tool errors while preserving the remote status and IDs in the JSON result.

## State and cancellation

Context mappings default to `~/.letta/a2a-client-contexts.json` and are written through an atomic replacement guarded by an exclusive lock file. Concurrent updates for different conversations preserve both mappings. The file contains identifiers only, not credentials or message content.

Calls to one local-conversation/target pair are serialized so two concurrent follow-ups cannot race the same remote context. Canceling the local tool interrupts waiting and polling; after a task has been accepted, the mod also attempts A2A `CancelTask` with a separate five-second budget.

## Development

```bash
cd packages/letta-a2a-client
bun install --frozen-lockfile
bun test
bun run check
```

`bun run check` type-checks the source and rebuilds the self-contained runtime entry at `dist/a2a-client.mjs`. Bundling the pinned official SDK makes local-path installation behave the same as registry installation; the managed package does not depend on a caller's `node_modules` layout.

## Current boundary

- A2A 1.0 JSON-RPC and text messages only.
- Named static routes only; agentgateway and OAuth are deliberately deferred.
- Polling rather than SSE keeps the model-facing tool lifecycle explicit.
- The mod is outbound-only. An inbound A2A server remains a separate long-lived service such as Example 14.
