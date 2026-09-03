# agentgateway configuration

This is the lab's only gateway configuration. It runs agentgateway v1.5.0 as one shared A2A-aware HTTP proxy in front of both Letta bridge routes and the independent reference agent.

Public paths:

```text
/a2a/agent-a
/a2a/agent-b
/a2a/reference-agent
```

The route rewrites map those public prefixes to the backends' native mount points. The `a2a` policy rewrites Agent Card interface URLs and adds A2A-specific fields to JSON access logs.

The A2A listener uses strict API-key authentication. The separate UI listener has no authentication because Compose publishes it only on host loopback; do not expose it beyond the local machine unchanged.

## Validate

```bash
A2A_GATEWAY_KEY=sk-a2a-lab-only docker run --rm \
  --env A2A_GATEWAY_KEY \
  --volume "$PWD/agentgateway/config.yaml:/config.yaml:ro" \
  cr.agentgateway.dev/agentgateway@sha256:bf2f339ef326d32def2aaeb44b1b4549801293c19b89e764a4228667d97d9896 \
  -f /config.yaml --validate-only
```

## Run

From the repository root:

```bash
docker compose up --build -d --wait
docker compose logs -f agentgateway bridge reference-agent
```

The A2A endpoint defaults to <http://127.0.0.1:4000>. The UI defaults to <http://127.0.0.1:4090/ui/>.

The evidence and remaining limits behind this choice are recorded in [`docs/GATEWAY_DECISION.md`](../docs/GATEWAY_DECISION.md).
