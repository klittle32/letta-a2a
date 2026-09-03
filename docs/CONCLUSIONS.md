# A2A Lab Conclusions

## Decision

A2A is a viable interoperability boundary for Letta agents. Letta can remain the stateful agent runtime while A2A provides discovery, task lifecycle, context continuity, and delegation between independently deployed agents.

The lab has answered the architectural question. Do not add more protocol machinery without a real use case that requires it.

## What the lab proved

- Two separately persisted Letta App Servers can call each other through A2A in both directions.
- A non-Letta Python agent built on the official A2A SDK interoperates through the same gateway pattern.
- Agent Cards, asynchronous `SendMessage`, `GetTask`, context continuation, terminal failure, and cancellation work through LiteLLM 1.97.0.
- Canceling an outer Letta task propagates to its accepted remote child task without releasing the same-conversation lock early or allowing conflicting terminal states.
- Separate LiteLLM lanes are necessary for nested calls in this version. Re-entering the active gateway process can deadlock.
- A2A 0.3 compatibility remains necessary behind LiteLLM because task forwarding does not preserve the 1.0 version header.

## What it did not prove

- Production authentication, tenant isolation, public endpoint hardening, or durable A2A task storage.
- Streaming, push notifications, or file artifacts.
- Communication between two physical hosts. The ordinary demo uses isolated containers on one host; the same protocol path can be extended across hosts once each gateway is published securely.
- Deterministic LLM behavior. Protocol-only tests are deterministic; live Letta delegation still depends on the configured model provider.

## Examples

The progressive, observable demonstrations now live in [`examples/`](../examples/README.md). Start with Agent Card discovery and basic messaging, then continue through context and [Letta delegating to an external A2A agent](../examples/04-letta-to-external-a2a-agent/).

The examples intentionally use Docker on one host. Multi-host deployment is a networking and operations concern rather than part of this focused protocol reference.

The earlier Letta-to-Letta proof remains available outside the primary two-implementation learning path:

```bash
node scripts/smoke-a2a.mjs agent-a \
  "Use a2a_invoke with target agent-b and message 'Reply with exactly AGENT_B_OK'. Then return only agent-b's answer."
```
