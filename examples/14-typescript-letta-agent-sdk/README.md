# Expose a Letta agent with the TypeScript SDKs

## What this teaches

Use the official JavaScript/TypeScript SDKs on both sides of one small adapter:

- `@a2a-js/sdk` owns the A2A 1.0 client, server, task store, and wire protocol.
- `@letta-ai/letta-agent-sdk` owns the persistent Letta agent, conversations, sessions, turns, and cancellation.
- `LettaAgentExecutor` translates between their lifecycle events.

No Rust binary, MCP server, gateway, OAuth fixture, or A2A 0.3 compatibility layer is involved. The optional outbound client mod remains a separate package so the inbound server has a clear process boundary.

## Message flow

```text
TypeScript A2A client
  → @a2a-js/sdk server
  → LettaAgentExecutor
  → @letta-ai/letta-agent-sdk
  → persistent local Letta agent
```

The runnable source is deliberately split by responsibility:

| File | Responsibility |
| --- | --- |
| [`client.ts`](src/client.ts) | Discover the Agent Card and send a streaming A2A 1.0 message. |
| [`server.ts`](src/server.ts) | Compose the official A2A request handler, task store, and Express transport. |
| [`letta-agent-executor.ts`](src/letta-agent-executor.ts) | Translate A2A tasks, statuses, artifacts, failures, and cancellation. |
| [`letta-agent.ts`](src/letta-agent.ts) | Run Letta SDK sessions and map A2A contexts to Letta conversations. |
| [`agent-card.ts`](src/agent-card.ts) | Advertise one A2A 1.0 JSON-RPC interface. |
| [`a2a-text.ts`](src/a2a-text.ts) | Convert the text-only message parts used by this example. |

## Run it

This example runs independently from the repository's Docker lab. It requires Node.js 22.19 or newer, Bun, and a model-provider credential supported by Letta.

Start the server:

```bash
cd examples/14-typescript-letta-agent-sdk
bun install --frozen-lockfile

export OPENAI_API_KEY='<your key>'
export A2A_LETTA_MODEL='openai/gpt-4.1-nano'
bun run start
```

The Letta Agent SDK starts and owns a local App Server subprocess. On the first run, the example creates a local agent named `A2A TypeScript Example Agent`. Later runs reuse that exact agent.

To expose an existing local agent instead, set its ID before starting:

```bash
export A2A_LETTA_AGENT_ID='agent-local-...'
```

For this bounded example, a reused agent must report an empty persisted tool list. Startup fails with the conflicting tool names rather than silently widening the noninteractive execution boundary. Use a dedicated tool-free agent here; broader per-agent policy belongs in a later authenticated deployment.

In a second terminal, discover the server without a separate CLI:

```bash
curl -fsS http://127.0.0.1:41241/.well-known/agent-card.json | jq
```

Then call it with the included TypeScript A2A client:

```bash
cd examples/14-typescript-letta-agent-sdk
bun run ask -- 'Remember the codeword ORCHID.'
```

Copy the returned `contextId` and continue the same conversation:

```bash
bun run ask -- --context '<context ID>' \
  'What codeword did I ask you to remember? Reply with only the codeword.'
```

## Add outbound A2A to Letta Code

The repository's [`letta-a2a-client`](../../packages/letta-a2a-client/) package gives ordinary local Letta Code sessions an `a2a_invoke` mod tool. It uses the official TypeScript A2A client; no Rust CLI or skill is required.

With this Example 14 server still running, configure and install the mod:

```bash
cat > ~/.letta/a2a-client.json <<'JSON'
{
  "routes": {
    "local-example": "http://127.0.0.1:41241"
  }
}
JSON

cd ../..
letta install ./packages/letta-a2a-client
```

Run `/reload`, then ask a local Letta Code agent:

> Use `a2a_invoke` with target `local-example` to ask the remote agent to reply with exactly `MOD_A2A_OK`.

The mod automatically preserves the returned remote A2A context for later calls from the same local Letta conversation. Its complete configuration, result contract, state behavior, and development commands are documented in the [package README](../../packages/letta-a2a-client/README.md).

The direct packaged-install, invocation, and cross-process continuity proof is retained in [`docs/evidence/2026-09-10-a2a-client-mod.md`](../../docs/evidence/2026-09-10-a2a-client-mod.md).

## Expected result

The first call ends with an A2A task and context ID:

```text
state=TASK_STATE_WORKING
I will remember the codeword ORCHID.
state=TASK_STATE_COMPLETED
taskId=...
contextId=...
```

The follow-up reuses the same opaque A2A context ID and answers from the same persistent Letta conversation:

```text
state=TASK_STATE_WORKING
ORCHID
state=TASK_STATE_COMPLETED
taskId=...
contextId=<same context ID>
```

## Watch it happen

Keep the server terminal visible. It prints the persistent Letta agent ID, discovery URL, and each A2A task transition:

```text
Letta agent: agent-local-...
Agent Card: http://127.0.0.1:41241/.well-known/agent-card.json
[a2a] task=... context=... started
[a2a] task=... state=TASK_STATE_COMPLETED
```

The client terminal prints streamed public assistant text, task states, and the IDs needed for continuation.

## What the controller is doing

[`LettaAgentExecutor`](src/letta-agent-executor.ts) is intentionally the center of the example. Its `execute()` method performs five visible translations:

1. Publish the A2A `submitted` task snapshot and `working` status.
2. Extract text from the incoming A2A message.
3. Ask `AgentSdkTurnRunner` to run one Letta turn in the conversation associated with the A2A context.
4. Publish only Letta assistant text as ordered A2A artifact chunks. Reasoning, tool activity, and internal runtime events stay private.
5. Publish exactly one terminal A2A state: `completed`, `failed`, or `canceled`.

`cancelTask()` aborts the task's `AbortController`. The signal either removes a queued turn before it starts or calls `session.abort()` on the active Letta SDK session. The executor—not the cancellation callback—publishes the final A2A state, avoiding competing terminal events.

[`AgentSdkTurnRunner`](src/letta-agent.ts) keeps protocol identity separate from agent identity:

```text
A2A contextId ──in-memory mapping──▶ Letta conversationId
A2A messageId ──OTID correlation──▶ Letta user message
```

A fresh SDK session is opened and closed for each turn. Closing the SDK session releases its process resources; it does not delete the persistent Letta agent or conversation.

## Boundaries

- A2A 1.0 JSON-RPC and text parts only. No v0.3 imports or compatibility flags.
- Loopback HTTP with no authentication. Add a gateway or middleware before exposing it beyond the local machine.
- A2A tasks and the context-to-conversation map are in memory. Restarting the server loses both mappings, while the underlying Letta agent and conversations remain persisted.
- One turn runs at a time per A2A context. Different contexts may run concurrently.
- Noninteractive SDK sessions stay in strict mode, request no base client toolset, and allowlist only `a2a_invoke`. A deterministic SDK permission callback approves that tool and denies every other approval request. Named or explicitly selected reused agents must also have no persisted tools or startup fails closed. When the outbound mod is installed but misconfigured, `a2a_invoke` remains visible and returns the configuration error; without the mod, it is absent.
- Push notifications, REST, gRPC, binary parts, and durable task storage are intentionally out of scope.
