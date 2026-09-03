# Gateway Decision: agentgateway

**Decision date:** 2026-09-03  
**Decision:** Replace LiteLLM with agentgateway as the lab's single A2A gateway.

## Why this was evaluated

LiteLLM 1.97.0 successfully proxied the lab's A2A traffic, but nested delegation could not re-enter the process handling the outer request. The working topology therefore required three identical LiteLLM processes—one target-specific lane for each agent.

Agentgateway is purpose-built for agent protocols and claimed A2A-aware routing, Agent Card rewriting, authentication, observability, and a local UI. The evaluation asked whether one agentgateway process could replace all three lanes without changing the established protocol behavior.

## Versions compared

- LiteLLM 1.97.0, previously pinned as `ghcr.io/berriai/litellm@sha256:468c25f35f3e5ec4e414974f00deab93337b1b4d9953cabcfd3722e59415f834`.
- agentgateway v1.5.0, pinned as `cr.agentgateway.dev/agentgateway@sha256:bf2f339ef326d32def2aaeb44b1b4549801293c19b89e764a4228667d97d9896`.

## Evaluation method

The candidate ran in a temporary Compose overlay while the primary LiteLLM stack remained unchanged. All three targets were routed by path through one agentgateway listener and one process. The existing protocol and live integration assertions then ran against that shared endpoint. Concise executed output is retained in [`evidence/2026-09-03-agentgateway-evaluation.md`](evidence/2026-09-03-agentgateway-evaluation.md).

The candidate had to prove:

- A2A 1.0 Agent Card discovery and externally usable URL rewriting.
- Asynchronous `SendMessage` and `GetTask` polling.
- Context continuation, terminal failure, and stable cancellation.
- Provider-backed Letta to external-agent delegation.
- Outer Letta cancellation propagating to the active remote child.
- No nested-call deadlock when both the outer and child traffic re-entered one gateway process.
- Strict API-key rejection for missing and incorrect credentials.
- Useful A2A-aware access logs and a reachable loopback UI.

## Results

Agentgateway passed the complete matrix through one shared process:

- Missing and incorrect API keys returned `401`; the configured lab key succeeded.
- Proxied backend Agent Cards retained their capabilities and skills, and their A2A 1.0 interface URLs were rewritten to the client-visible gateway path.
- Discovery, asynchronous task polling, context continuation, failure, direct cancellation, and terminal-state stability passed.
- Live Letta delegation to the independent reference agent passed.
- Canceling the outer Letta task canceled its accepted remote child and both remained terminal.
- Nested traffic safely re-entered the same agentgateway process; the LiteLLM lane workaround was unnecessary.
- JSON stdout logs identified `a2a.method`, result kind, task state, context ID, route, backend, status, and duration.
- The separate loopback UI endpoint loaded successfully.

One initial live run returned a model-generated typo in the requested exact token. The bridge had invoked the remote agent successfully and the subsequent identical run passed; this was model nondeterminism, not a gateway transport failure.

## Known limits

- Agentgateway v1.5.0 is an A2A-aware HTTP proxy, not proof of complete A2A 1.0 conformance. It does not parse or enforce `A2A-Version` or validate every protocol schema.
- Rewriting a signed A2A 1.0 Agent Card changes its interface URLs without re-signing it. Upstream issue [#2701](https://github.com/agentgateway/agentgateway/issues/2701) tracks the broader conformance gap.
- The UI's log-search API returned zero stored A2A records during this evaluation even though stdout contained rich A2A telemetry. The lab therefore treats structured stdout as the observed A2A diagnostic surface and does not configure a database solely for the UI.
- Gateway authentication is enforced, but the proxied backend cards do not yet declare that gateway policy in their A2A security fields. Aligning advertised security with enforcement remains example 06.
- Streaming, push notifications, and signed-card behavior were not part of this decision.

## Decision rationale

Agentgateway keeps all proven behavior while reducing the topology from three gateway processes to one. It also preserves richer backend Agent Cards, enforces the lab key directly, and emits A2A-specific telemetry. Those improvements are material to an educational A2A reference implementation.

The repository now keeps only agentgateway. The temporary comparison overlay and LiteLLM configuration were removed rather than maintained as parallel implementations.

## Re-run the protocol and live behavior

```bash
bun run test:protocol
OPENAI_API_KEY="$OPENAI_API_KEY" bun run test:integration
```

Both commands create an isolated Compose project with dynamic loopback ports and remove it afterward. UI reachability, stored-log behavior, and exact stdout fields were manual evaluation observations recorded in the dated evidence file; these two commands do not assert those surfaces.

## Sources

- [agentgateway v1.5.0 release](https://github.com/agentgateway/agentgateway/releases/tag/v1.5.0)
- [Official A2A proxy guide](https://agentgateway.dev/docs/standalone/latest/agent/a2a/)
- [Docker installation](https://agentgateway.dev/docs/standalone/latest/setup/install/docker/)
- [API-key authentication](https://agentgateway.dev/docs/standalone/latest/configuration/security/apikey-authn/)
- [Access-log behavior](https://agentgateway.dev/docs/standalone/latest/observability/access-logs/view/)
