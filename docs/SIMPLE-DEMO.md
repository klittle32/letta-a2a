# Simple Agent-to-Agent Demo

This example shows two separately persisted Letta agents communicating through A2A. Agent A receives the original request, delegates to Agent B, waits for Agent B's A2A task, and returns Agent B's answer.

```text
client
  │
  ▼
LiteLLM A ──▶ Agent A ──a2a_invoke──▶ LiteLLM B ──▶ Agent B
  ▲                                                        │
  └──────────────────── A2A result ◀────────────────────────┘
```

The two Letta agents run in separate containers with separate state and workspace volumes. The bridge and two LiteLLM lanes provide the A2A path between them.

## 1. Start the lab

```bash
docker compose up --build -d
docker compose ps
```

Wait until every service reports healthy.

## 2. Watch the communication

Open a terminal and follow the relevant services:

```bash
docker compose logs -f --since=0s \
  agent-a agent-b bridge litellm-a litellm-b
```

## 3. Send the request

In another terminal, run:

```bash
node scripts/smoke-a2a.mjs agent-a \
  "Use a2a_invoke with target agent-b and message 'Reply with exactly CROSS_ENVIRONMENT_OK'. Then return only agent-b's answer."
```

## 4. Expected result

The final A2A task should be completed and contain:

```json
{
  "status": {
    "state": "TASK_STATE_COMPLETED"
  },
  "artifacts": [
    {
      "parts": [
        {
          "text": "CROSS_ENVIRONMENT_OK"
        }
      ]
    }
  ]
}
```

Task, context, message, and artifact IDs are generated for each run and will differ from one invocation to the next.

## 5. What to look for in the logs

The important lines are:

```text
[agent-a] app-server event external_tool_call_request
[agent-a] invoking agent-b through http://litellm-b:4000
[agent-a] received A2A result from agent-b
```

You should also see:

- `litellm-a` receiving the outer `/a2a/agent-a` requests.
- `litellm-b` receiving the nested `/a2a/agent-b` requests.
- `agent-a` receiving the user input and external-tool response.
- `agent-b` starting its own runtime turn and receiving the delegated input.

Together, those events show that Agent A did not manufacture the answer locally: it opened an A2A task against Agent B, Agent B handled the delegated request in its own environment, and the result returned through the bridge.

## Environment boundary

This is a real cross-agent and cross-runtime demonstration, but both environments are containers on one physical host. A two-host demonstration uses the same A2A flow, with each LiteLLM endpoint and advertised Agent Card URL made securely reachable across HTTPS or a private network such as Tailscale. Do not publish the fixed lab credentials or private Compose services directly.
