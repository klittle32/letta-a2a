# A2A Lab Conclusions

## Decision

A2A is a viable interoperability boundary for Letta agents. Letta can remain the stateful agent runtime while A2A provides discovery, task lifecycle, context continuity, and delegation between independently deployed agents.

The lab has answered the architectural question. Do not add more protocol machinery without a real use case that requires it.

## What the lab proved

- Two separately persisted Letta App Servers can call each other through A2A in both directions.
- A non-Letta Python agent built on the official A2A SDK interoperates through the same gateway.
- Agent Cards, asynchronous `SendMessage`, `GetTask`, context continuation, terminal failure, and cancellation work through LiteLLM 1.97.0.
- Canceling an outer Letta task propagates to its accepted remote child task without releasing the same-conversation lock early or allowing conflicting terminal states.
- Separate LiteLLM lanes are necessary for nested calls in this version. Re-entering the active gateway process can deadlock.
- A2A 0.3 compatibility remains necessary behind LiteLLM because task forwarding does not preserve the 1.0 version header.

## What it did not prove

- Production authentication, tenant isolation, public endpoint hardening, or durable A2A task storage.
- Streaming, push notifications, or file artifacts.
- Communication between two physical hosts. The ordinary demo uses isolated containers on one host; the same protocol path can be extended across hosts once each gateway is published securely.
- Deterministic LLM behavior. Protocol-only tests are deterministic; live Letta delegation still depends on the configured model provider.

## Simple observable demo

Start the lab:

```bash
docker compose up --build -d
docker compose ps
```

In one terminal, watch the two isolated Letta environments and their A2A path:

```bash
docker compose logs -f --since=0s \
  agent-a agent-b bridge litellm-a litellm-b
```

In another terminal, ask Agent A to call Agent B:

```bash
node scripts/smoke-a2a.mjs agent-a \
  "Use a2a_invoke with target agent-b and message 'Reply with exactly CROSS_ENVIRONMENT_OK'. Then return only agent-b's answer."
```

The result should contain `CROSS_ENVIRONMENT_OK`. In the logs, the bridge should show Agent A invoking `agent-b` through `http://litellm-b:4000`, App Server tool events, and the returned A2A result.

## Extending the demo across physical environments

The protocol does not change. Each environment needs a securely reachable LiteLLM A2A endpoint and an Agent Card URL whose advertised address is reachable from the other environment. Keep each target on a separate gateway lane, use HTTPS or a private network such as Tailscale, and replace the fixed lab credential with per-environment credentials. Do not expose the current Compose services or lab keys directly.
