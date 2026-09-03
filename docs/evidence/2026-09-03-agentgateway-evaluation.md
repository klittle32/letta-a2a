# agentgateway evaluation evidence — 2026-09-03

This is the concise point-in-time evidence used for [`../GATEWAY_DECISION.md`](../GATEWAY_DECISION.md). It records executed checks rather than claiming broader A2A conformance.

## Environment

- macOS host with Docker Desktop
- agentgateway v1.5.0 image digest `sha256:bf2f339ef326d32def2aaeb44b1b4549801293c19b89e764a4228667d97d9896`
- One agentgateway container and one shared A2A listener for all three routes
- Existing Letta bridge, two isolated Letta runtimes, and independent Python reference agent

## Candidate evaluation before promotion

The candidate first ran through a temporary Compose overlay, leaving the LiteLLM stack unchanged.

Configuration checks:

```text
Configuration is valid!
✓ agentgateway schema and Compose configuration
```

Gateway checks:

```text
✓ strict gateway API-key authentication
✓ A2A 1.0 Agent Card URL rewriting
✓ loopback-only UI endpoint
✓ UI log API reachable (0 stored A2A records returned)
✓ structured A2A access-log telemetry
```

Provider-free protocol result:

```text
✓ Agent Card discovery through agentgateway
✓ asynchronous SendMessage and GetTask
✓ context continuation
✓ terminal failure propagation
✓ deterministic cancellation remains terminal

Independent A2A integration: PASS
```

Provider-backed result through the same shared gateway process:

```text
✓ Agent Card discovery through agentgateway
✓ asynchronous SendMessage and GetTask
✓ context continuation
✓ terminal failure propagation
✓ deterministic cancellation remains terminal
✓ Letta Agent Card preservation and URL rewriting
✓ provider-backed Letta Agent A to independent reference agent
✓ outer cancellation propagates to the remote child task

Independent A2A integration: PASS
agentgateway evaluation: PASS
```

The first provider-backed attempt reached the remote agent but the model returned `LETT_REFERENCE_OK` instead of the requested `LETTA_REFERENCE_OK`. The identical retry passed. This is retained here because the live assertion is model-dependent.

## Observed structured log shape

Agentgateway emitted one JSON line per request. Representative fields observed on the tested paths included:

```json
{
  "scope": "request",
  "listener": "a2a",
  "route": "default/reference-agent",
  "endpoint": "reference-agent:8090",
  "http.method": "POST",
  "http.path": "/a2a/reference-agent",
  "http.status": 200,
  "protocol": "a2a",
  "a2a.method": "CancelTask",
  "a2a.response.outcome": "success",
  "a2a.task.state": "TASK_STATE_CANCELED",
  "a2a.context.id": "<generated-context-id>",
  "duration": "<measured-duration>"
}
```

The UI HTML endpoint returned `200` and contained the agentgateway application. With SQLite configured during the candidate evaluation, `POST /api/logs/search` returned `200` with an empty `logs` array after the A2A matrix. Structured stdout—not the UI database—is therefore the observed A2A diagnostic surface.

## Final promoted-stack verification

After replacing the primary gateway and deleting the temporary overlay, these checks passed:

```text
25 Bun tests passed
13 Python tests passed
TypeScript no-emit check passed
TypeScript production build passed
Compose configuration validation passed
agentgateway --validate-only passed
provider-free protocol matrix passed
provider-backed delegation and nested-cancellation matrix passed
ordinary Compose startup and reference-agent smoke request passed
missing gateway key returned 401
proxied reference Agent Card retained skills and an A2A 1.0 interface
loopback UI returned recognizable HTML
```

The final protocol runner also checks missing and incorrect keys on both Agent Card GET and JSON-RPC POST requests. Protocol-only mode starts only agentgateway and the deterministic reference agent; the two Letta runtimes and bridge are reserved for the provider-backed suite.

Managed integration projects and the ordinary validation stack were stopped after their runs.
