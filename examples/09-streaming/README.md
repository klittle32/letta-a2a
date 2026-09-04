# 09 — Streaming

## What this teaches

A2A can return an ordered stream of task lifecycle and artifact updates over Server-Sent Events instead of making the client poll for every change. Both agents now advertise streaming and accept the A2A 1.0 `SendStreamingMessage` method through the same authenticated agentgateway route used by ordinary JSON-RPC calls.

The external reference agent emits deterministic text chunks. The Letta bridge translates only top-level `assistant_message` text from the App Server WebSocket; reasoning, tool activity, command output, subagent output, and unknown runtime events remain private.

Executed verification is retained in [`docs/evidence/2026-09-04-example-09.md`](../../docs/evidence/2026-09-04-example-09.md).

## Message flow

```text
A2A client ── POST SendStreamingMessage ──▶ agentgateway ──▶ A2A agent
           ◀── text/event-stream ─────────┤
               Task(SUBMITTED)            │
               Status(WORKING)            │
               Artifact(chunk, append)    │
               Artifact(final chunk)      │
               Status(COMPLETED)          │
```

## Run it

Start the current lab and load its disposable operator credentials:

```bash
cp .env.example .env
nvim .env
docker compose up --build -d --wait

set -a
source .env
set +a
```

Obtain a token that can discover and invoke agents:

```bash
export ACCESS_TOKEN="$(curl -fsS \
  -u "$OAUTH_CLIENT_ID:$OAUTH_CLIENT_SECRET" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode 'scope=a2a.discover a2a.invoke' \
  http://127.0.0.1:9000/token \
  | jq -r '.access_token')"
```

Confirm that the gateway-published card advertises streaming:

```bash
curl -fsS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://127.0.0.1:4000/a2a/reference-agent/.well-known/agent-card.json \
  | jq '.capabilities.streaming'
```

Use `curl -N` to display each SSE record without client-side buffering:

```bash
curl -NfsS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'A2A-Version: 1.0' \
  -H 'Accept: text/event-stream' \
  -H 'Content-Type: application/json' \
  --data '{
    "jsonrpc": "2.0",
    "id": "stream-demo",
    "method": "SendStreamingMessage",
    "params": {
      "message": {
        "messageId": "stream-demo-message",
        "role": "ROLE_USER",
        "parts": [{"text": "stream STREAMING_OK"}]
      }
    }
  }' \
  http://127.0.0.1:4000/a2a/reference-agent
```

Run the deterministic gateway matrix and the provider-backed Letta stream:

```bash
bun run test:protocol
bun run test:integration
```

## Expected result

The card command prints `true`. The streaming call returns `Content-Type: text/event-stream` and a sequence of `data:` records. Omitting generated IDs and timestamps, their result variants are:

```text
task.status.state                         TASK_STATE_SUBMITTED
statusUpdate.status.state                 TASK_STATE_WORKING
artifactUpdate "S" append=false          lastChunk=false
artifactUpdate "T" append=true           lastChunk=false
... one ordered character per update ...
artifactUpdate "K" append=true           lastChunk=true
statusUpdate.status.state                 TASK_STATE_COMPLETED
```

All artifact updates reuse one artifact ID. Concatenating their text parts yields `STREAMING_OK`. A later `GetTask` returns the same assembled artifact.

The live suite sends `SendStreamingMessage` to Letta Agent A and receives `LETTA_STREAM_OK` as one or more safe text chunks before the completed status.

## Watch it happen

Watch the gateway and both streaming implementations:

```bash
docker compose logs -f --since=0s agentgateway bridge reference-agent
```

Run the `curl -N` command in a second terminal. The wire response contains only public A2A task/status/artifact envelopes. Detailed Letta runtime activity remains in the private App Server connection and bridge logs.

## What the controller is doing

The installed JavaScript and Python A2A SDK request handlers already implement `SendStreamingMessage` and SSE framing. Each executor publishes an initial task snapshot, working status, one or more artifact updates, and a terminal status. The SDK persists each update while yielding it, so ordinary `GetTask` retrieval sees the same accumulated result.

The reference agent's `stream TEXT` fixture publishes one Unicode character at a time with a stable artifact ID. The first update replaces the artifact, later updates append, and only the final text update has `lastChunk=true`.

For Letta, the runtime adapter uses an allowlist: only a top-level App Server `stream_delta` whose payload is an `assistant_message` contributes public text. It discards reasoning, tools, commands, status messages, subagent output, and unknown future variants. The executor holds one pending assistant delta so the final non-empty chunk—not a synthetic empty event—can carry `lastChunk=true`.

If the Letta runtime fails, the public terminal message is the stable `Letta turn failed`; raw provider or App Server diagnostics are not copied into A2A output. Validation errors generated by the bridge itself remain specific and actionable.

Breaking the SSE connection does not imply A2A cancellation. The deterministic reference-agent probe observes the task still working, disconnects, and then retrieves its completed result with `GetTask`. Cancellation remains the explicit `CancelTask` operation proven by Example 10.

## Boundaries

- This example proves ordered SSE records through the pinned gateway, not a latency or throughput target.
- The bridge streams only final-channel assistant text. It deliberately exposes no private reasoning, tool arguments/results, command output, or subagent events.
- Already-delivered partial artifact chunks cannot be retracted. Failed or canceled streams never mark partial output as a final chunk.
- The outbound `a2a_invoke` clients still use asynchronous task creation plus polling. Streaming is currently implemented for inbound A2A calls, not nested outbound delegation.
- The reference-agent probe proves that client disconnect is not cancellation. A provider-backed Letta disconnect was not added to this example. This proves later `GetTask` retrieval, not `SubscribeToTask` resumption.
- Active tasks remain in memory, as in earlier examples. Process restarts still lose A2A task records.
- Push notifications are demonstrated separately in Example 11; an SSE connection itself remains a streaming response, not a callback registration.
