# A2A Lab Conclusions

## Decision

A2A is a viable interoperability boundary for Letta agents. Letta can remain the stateful agent runtime while A2A provides discovery, task lifecycle, context continuity, and delegation between independently deployed agents.

The lab has answered the architectural question. Do not add more protocol machinery without a real use case that requires it.

## What the lab proved

- Two separately persisted Letta App Servers can call each other through A2A in both directions.
- A non-Letta Python agent built on the official A2A SDK can both receive delegated work from Letta and initiate work against Letta through the same shared gateway.
- Agent Cards, asynchronous `SendMessage`, `GetTask`, context continuation, terminal failure, and cancellation work through agentgateway v1.5.0.
- Canceling an outer Letta task propagates to its accepted remote child task without releasing the same-conversation lock early or allowing conflicting terminal states.
- Nested calls safely re-enter one agentgateway process, so target-specific gateway lanes are unnecessary.
- Agentgateway preserves and rewrites the richer backend Agent Cards rather than replacing them with minimal config-defined cards.
- The gateway-published cards advertise an OAuth2 client-credentials flow and required scope. Calling agents exchange credentials, cache short-lived JWTs, and refresh near expiry.
- Agentgateway verifies the local issuer, audience, RSA signature, expiry/not-before, and subject, then requires `a2a.invoke`. Missing, malformed, wrong-signature, and expired tokens receive `401`; a valid token with the wrong scope receives `403`.

## What it did not prove

- Production identity, tenant isolation, differentiated caller authorization, public endpoint hardening, or durable A2A task storage. The local OAuth server is only a deterministic fixture.
- Streaming, push notifications, or file artifacts.
- Communication between two physical hosts. The ordinary demo uses isolated containers on one host; the same protocol path can be extended across hosts once each gateway is published securely.
- Deterministic LLM behavior. Protocol-only tests are deterministic; live Letta delegation still depends on the configured model provider.
- Complete A2A 1.0 gateway conformance, signed-card rewriting, or database-backed A2A logs. See [`GATEWAY_DECISION.md`](GATEWAY_DECISION.md).

## Examples

The progressive, observable demonstrations now live in [`examples/`](../examples/README.md). Start with Agent Card discovery and basic messaging, then continue through context, [Letta delegating to an external A2A agent](../examples/04-letta-to-external-a2a-agent/), and the [external agent delegating back to Letta](../examples/05-external-a2a-agent-to-letta/).

The examples intentionally use Docker on one host. Multi-host deployment is a networking and operations concern rather than part of this focused protocol reference. Example 06 preserves the superseded static-key stage; Example 07 is the current OAuth-protected stack.

The earlier Letta-to-Letta proof remains available outside the primary two-implementation learning path:

```bash
node scripts/smoke-a2a.mjs agent-a \
  "Use a2a_invoke with target agent-b and message 'Reply with exactly AGENT_B_OK'. Then return only agent-b's answer."
```
