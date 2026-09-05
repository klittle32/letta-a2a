# Example 12 implementation plan

## Goal

Demonstrate a real person using a Dockerized [Hermes Agent](https://github.com/NousResearch/hermes-agent) TUI as an A2A client: Hermes calls its built-in `a2a_call` tool, the request crosses this repository's existing `agentgateway`, and a remote agent built with [Google Agent Development Kit (ADK)](https://google.github.io/adk-docs/a2a/quickstart-exposing/) answers. A second call reuses the same A2A `contextId` and proves that the remote conversation continued.

This is a client-harness interoperability example, not another protocol feature. The logical participants remain Hermes and the ADK agent; `agentgateway` is policy and transport infrastructure.

## Delivery status

Implemented and verified on 2026-09-04. The delivered walkthrough is [`examples/12-hermes-tui-to-google-adk/`](../examples/12-hermes-tui-to-google-adk/), and executed evidence is retained in [`docs/evidence/2026-09-04-example-12.md`](evidence/2026-09-04-example-12.md). Final pins are Hermes `v2026.8.31` at OCI digest `sha256:64923faeae267792bf9bf87fe3b4c4869e35004e360c7df01730ad801b74d524`, Google ADK `2.8.0`, and A2A SDK `1.1.2`.

## Target flow

```text
operator
   │ interactive terminal
   ▼
Hermes TUI container
   │ Hermes model selects built-in a2a_call
   │ A2A 1.0 SendMessage + short-lived Bearer JWT
   ▼
existing agentgateway
   │ validates OAuth identity, role, and scope
   │ rewrites the public Agent Card/RPC URL
   ▼
Google ADK A2A container
   │ to_a2a(root_agent)
   ▼
text artifact returned to the visible Hermes TUI
```

Hermes is outbound-only in this example. Do not enable its inbound A2A listener; it would add an unrelated server and security boundary.

## Acceptance criteria

1. Hermes runs from `docker.io/nousresearch/hermes-agent` at an exact release and OCI digest that includes the three-layer CLI/TUI A2A tool-registration fix merged in [PR #86660](https://github.com/NousResearch/hermes-agent/pull/86660). The delivered pin is Hermes Agent `v0.21.0` / `v2026.8.31` at `sha256:64923faeae267792bf9bf87fe3b4c4869e35004e360c7df01730ad801b74d524`.
2. The Hermes data directory is a dedicated volume, the container is attached only to `a2a-clients`, agentgateway spans that network and `a2a-lab`, and `hermes --tui` receives a real TTY.
3. The `a2a` toolset is explicitly enabled for platform `cli`, a named `google-adk` peer is configured, and `/tools` in the TUI shows `a2a_call`.
4. The remote service is built with pinned `google-adk[a2a]` and A2A Python SDK 1.x dependencies, wraps one `root_agent` with `to_a2a()`, and exposes text input/output only on the private Compose network. Its supplied A2A 1.0 Agent Card declares the existing OAuth2 client-credentials scheme and required scopes rather than advertising an unauthenticated backend.
5. The only Hermes-to-ADK network path uses `http://agentgateway:4000/a2a/google-adk`; the ADK port is not published to the host. Every JSON-RPC interface advertised by the gateway-published card points back through that gateway route and contains no backend hostname, backend port, `localhost`, or `0.0.0.0`.
6. A dedicated OAuth client with role `agent` and scopes `a2a.discover a2a.invoke` is added for Hermes. The named-peer configuration fixes Hermes's target to `/a2a/google-adk`; the current gateway still authorizes eligible routes by role, scope, method, and path shape rather than subject-specific route grants. The client secret and access token never enter source, image layers, Agent Cards, or logs.
7. A launcher obtains a fresh client-credentials token immediately before starting the TUI, exports it only to that process, and lets Hermes resolve `${HERMES_A2A_ACCESS_TOKEN}` in its peer configuration. The initial demo TTL is 900 seconds, with an explicit relaunch-after-expiry instruction; the example does not add a hidden refresh daemon.
8. From the TUI, the operator asks Hermes to use `a2a_call` against `google-adk`. The visible tool event and gateway log prove that the built-in tool—not `curl`, a shell wrapper, or a model-authored imitation—made the call.
9. A first remote turn stores a distinctive codeword. A second TUI turn calls the same peer with the prior `context_id`, and the ADK agent returns that codeword. Structured gateway logs plus an ADK request spy/evidence record correlate distinct request/message IDs with one shared context ID; the proof does not rely only on model-visible prose.
10. Provider-free tests cover the ADK app, card shape, gateway route, OAuth bootstrap, token non-disclosure, and two-turn context behavior. An opt-in live test covers the actual Hermes model/tool call and ADK model response. Existing protocol and live suites remain green.

## Design decisions

### Preserve the current gateway security model

Do not restore the historical static-key gateway from Example 06 merely because Hermes accepts a configured Bearer token. The current gateway already validates short-lived JWTs, roles, and scopes. Hermes does not acquire OAuth tokens itself, but it does support environment-variable substitution in `config.yaml`, so the small compatibility seam belongs in the operator launcher:

```yaml
a2a_agents:
  google-adk:
    url: "http://agentgateway:4000/a2a/google-adk"
    auth:
      type: bearer
      token: "${HERMES_A2A_ACCESS_TOKEN}"
    timeout: 120
    capabilities: [conversation]
```

The launcher performs one client-credentials exchange, validates that the token response is complete, exports the access token, and `exec`s `hermes --tui`. It must not print the token or write it into the mounted Hermes home. Use a dedicated subject rather than reusing the operator, bridge, or reference-agent identity; do not claim gateway-enforced subject-to-route binding in this slice.

Hermes `v2026.8.31` has two relevant upstream constraints:

- `a2a_call` applies the configured Bearer token to its Agent Card fetch and `SendMessage` request.
- `a2a_discover(url)` has no authenticated-call option.

Therefore this example demonstrates the named-peer `a2a_call` path. Authenticated card retrieval is tested outside the model turn, but the README must not tell the operator to use `a2a_discover` through the protected gateway unless a later pinned Hermes release adds authenticated discovery.

### Use the stock Hermes tool

Do not patch Hermes, mount a replacement plugin, or wrap the remote call in a shell skill. Initialization may run the documented command:

```bash
hermes tools enable a2a --platform cli
```

The persisted configuration and a source-level test should verify that the resulting CLI/TUI toolset contains `a2a`. The inbound Hermes A2A platform remains disabled.

### Keep the ADK agent small

Create one repo-owned ADK agent rather than vendoring Google's entire sample tree. Follow the documented `to_a2a(root_agent, agent_card=...)` shape, but give the agent a narrow conversational instruction suitable for a two-turn continuity proof and a repo-owned card matching the gateway's OAuth policy. Pin both ADK and `a2a-sdk`; the initial researched candidate is ADK `2.8.0` with A2A SDK 1.x, but resolve and lock the exact compatible versions during implementation.

The default `to_a2a()` task/session stores are in memory. That is acceptable here: the proof is continuity across two calls while the container remains running, not durability across service recreation.

### Match Hermes's synchronous client behavior

The pinned Hermes client sends `SendMessage` and waits for that HTTP response. It does not poll a submitted task, consume SSE, or issue outbound cancellation. Configure the ADK example to finish within the named peer timeout and return a completed text result on that request path. Do not claim that the TUI demonstrates remote streaming merely because Hermes streams its own UI updates.

## Expected implementation surface

- `services/google-adk-agent/` — pinned `uv` project, minimal ADK agent, Dockerfile, and tests.
- `agentgateway/config.yaml` — one `/a2a/google-adk` route using the existing A2A policy and JWT gateway.
- `compose.yaml` — optional/profile-gated `google-adk-agent` and `hermes-tui` services plus an isolated Hermes state volume.
- `services/reference-agent/src/reference_agent/auth_server.py` — one dedicated Hermes client registration, with tests.
- `examples/12-hermes-tui-to-google-adk/` — the completed walkthrough only after behavior exists.
- A small launcher that obtains the JWT without logging or persisting it, verifies the protected Agent Card, and starts `hermes --tui` with stdin/stdout attached.
- Focused configuration, protocol, and live-test coverage plus an executed evidence note.

These are intended seams, not permission to duplicate the primary Compose stack. Prefer one optional Compose profile and shared gateway/auth fixtures.

Example 13 reuses this ADK service, Agent Card, and gateway route as a target for the official `a2acli`; it adds no policy to the ADK agent itself.

## Test-first slices

1. Add failing configuration tests for the exact Hermes/ADK pins, optional services, private networking, gateway route, and absence of committed credentials.
2. Add failing OAuth and gateway-authorization tests for a distinct Hermes client identity, allowed scopes/role, the fixed named-peer route, bad credentials, and token non-disclosure.
3. Add failing ADK tests using a deterministic fake model/session seam: card generation, first turn, second turn with the same context, malformed input, and bounded failure.
4. Implement the minimal ADK `root_agent`, `to_a2a()` app, container, route, and health check.
5. Add failing launcher tests for token acquisition, `${HERMES_A2A_ACCESS_TOKEN}` configuration, no stdout/stderr leakage, expiry handling, TTY preservation, and failed preflight.
6. Add the pinned Hermes service and enable only `hermes-cli` plus `a2a` for CLI/TUI sessions.
7. Extend the provider-free Docker matrix to fetch the protected, rewritten ADK card and complete a two-turn A2A exchange through `agentgateway` without Hermes or a live model.
8. Add an opt-in live one-shot Hermes proof that records an actual `a2a_call`, then perform and record the interactive TUI walkthrough.
9. Write the Example 12 README with copyable start/stop commands, expected tool card and context ID, and filtered Hermes/agentgateway/ADK log commands that correlate both requests, message IDs, and the shared context ID.

## Explicit non-goals

- exposing Hermes as an inbound A2A server;
- three-agent orchestration or `a2a_orchestrate`;
- unauthenticated or static-key regression of the current gateway;
- teaching OAuth token refresh inside Hermes;
- authenticated `a2a_discover` until Hermes supports it;
- A2A streaming, push notifications, file parts, or remote cancellation;
- ADK Live mode, `RemoteA2aAgent`, gRPC, or an ADK web UI;
- durable ADK task/session storage across container recreation;
- deterministic claims about either live model's wording;
- a production deployment recipe.

## Upstream references checked for this plan

- [Hermes A2A guide](https://github.com/NousResearch/hermes-agent/blob/v2026.8.31/website/docs/user-guide/messaging/a2a.md)
- [Hermes A2A client implementation](https://github.com/NousResearch/hermes-agent/blob/v2026.8.31/plugins/platforms/a2a/tools.py)
- [Hermes Docker guide](https://github.com/NousResearch/hermes-agent/blob/v2026.8.31/website/docs/user-guide/docker.md)
- [Hermes CLI/TUI tool-registration fix](https://github.com/NousResearch/hermes-agent/pull/86660)
- [Google ADK exposing quickstart](https://google.github.io/adk-docs/a2a/quickstart-exposing/)
- [Google ADK `to_a2a()` sample](https://github.com/google/adk-python/blob/main/contributing/samples/a2a/a2a_root/remote_a2a/hello_world/agent.py)
