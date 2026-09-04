# A2A Lab Conclusions

## Decision

A2A is a viable interoperability boundary for Letta agents. Letta can remain the stateful agent runtime while A2A provides discovery, task lifecycle, context continuity, streaming, asynchronous notification, and delegation between independently deployed agents.

The lab has answered the architectural question. Do not add more protocol machinery without a real use case that requires it.

## What the lab proved

- Two separately persisted Letta App Servers can call each other through A2A in both directions.
- A non-Letta Python agent built on the official A2A SDK can both receive delegated work from Letta and initiate work against Letta through the same shared gateway.
- Agent Cards, asynchronous `SendMessage`, `GetTask`, context continuation, ordered SSE streaming, terminal failure, and cancellation work through agentgateway v1.5.0.
- Canceling an outer Letta task propagates to its accepted remote child task without releasing the same-conversation lock early or allowing conflicting terminal states.
- Nested calls safely re-enter one agentgateway process, so target-specific gateway lanes are unnecessary.
- Agentgateway preserves and rewrites the richer backend Agent Cards rather than replacing them with minimal config-defined cards.
- The gateway-published cards advertise an OAuth2 client-credentials flow and required scope. Calling agents exchange credentials, cache short-lived JWTs, and refresh near expiry.
- Agentgateway verifies the local issuer, audience, RSA signature, expiry/not-before, subject, role, and scope. Discovery requires `a2a.discover`; invocation requires `a2a.invoke` plus an `operator` or `agent` role. Authentication failures receive `401`, while authenticated but unauthorized callers receive `403`.
- Agentgateway preserves ordered A2A SSE streams. Both agent implementations publish task/status/artifact events; the Letta bridge exposes only top-level assistant text and persists the assembled artifact for later retrieval.
- Both agent implementations support the demonstrated A2A 1.0 push-notification lifecycle. Registrations are restricted to one configured callback and Bearer credential, delivery does not block task processing, the separately authenticated receiver handles identical deliveries idempotently, and a later `GetTask` remains authoritative.

## What it did not prove

- Production identity, tenant isolation, resource-level authorization, public endpoint hardening, or durable A2A task storage. The local OAuth server and fixed role registry are only deterministic fixtures.
- Binary/file parts.
- Durable or exactly-once push delivery, retries, arbitrary callback destinations, cryptographic replay prevention, or persistence of tasks, callback registrations, and receiver observations across restarts.
- Communication between two physical hosts. The ordinary demo uses isolated containers on one host; the same protocol path can be extended across hosts once each gateway is published securely.
- Deterministic LLM behavior. Protocol-only tests are deterministic; live Letta delegation still depends on the configured model provider.
- Complete A2A 1.0 gateway conformance, signed-card rewriting, or database-backed A2A logs. See [`GATEWAY_DECISION.md`](GATEWAY_DECISION.md).

## Examples

The progressive, observable demonstrations now live in [`examples/`](../examples/README.md). Start with Agent Card discovery and basic messaging, then continue through context, [Letta delegating to an external A2A agent](../examples/04-letta-to-external-a2a-agent/), and the [external agent delegating back to Letta](../examples/05-external-a2a-agent-to-letta/).

The implemented examples intentionally use Docker on one host. Multi-host deployment is a networking and operations concern rather than part of this focused protocol reference. Examples 06–08 preserve the static-key, shared-identity OAuth, and caller-authorization stages; Examples 09–11 complete the current stack with streaming, failure/cancellation, and authenticated push notifications.

Three planned examples extend the answered protocol question only for concrete interoperability use cases: [Example 12](EXAMPLE_12_IMPLEMENTATION_PLAN.md) puts a Dockerized Hermes interactive TUI in the caller seat against a Google ADK agent; [Example 13](EXAMPLE_13_IMPLEMENTATION_PLAN.md) demonstrates one portable skill in Letta Code and Codex using the client-only CLI shipped by the official Rust SDK; and [Example 14](EXAMPLE_14_IMPLEMENTATION_PLAN.md) composes A2A with one persistent ACPX Claude session. None is a reason to broaden the core lab into general orchestration infrastructure.

The earlier Letta-to-Letta proof remains available outside the primary two-implementation learning path:

```bash
node scripts/smoke-a2a.mjs agent-a \
  "Use a2a_invoke with target agent-b and message 'Reply with exactly AGENT_B_OK'. Then return only agent-b's answer."
```
