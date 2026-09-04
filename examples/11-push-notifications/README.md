# 11 — Push Notifications

## What this teaches

A2A push notifications let a caller receive task updates after the initiating request has returned, without holding an SSE connection open or repeatedly polling `GetTask`.

This example registers one exact lab callback URL with a Bearer credential, waits for a later terminal webhook, and only then retrieves the authoritative task. Both the Letta bridge and external reference agent implement the same A2A 1.0 flow.

Executed verification is retained in [`docs/evidence/2026-09-04-example-11.md`](../../docs/evidence/2026-09-04-example-11.md).

## Message flow

```text
caller ── SendMessage + callback ──▶ agentgateway ──▶ A2A agent
caller ◀── Task(SUBMITTED) ─────────┘                    │
                                                        │ Bearer-authenticated
caller is no longer polling                             │ A2A event POST
                                                        ▼
caller ◀── observes terminal hint ───────────── webhook receiver
   │
   └── GetTask ──▶ agentgateway ──▶ authoritative completed task
```

## Run it

Start the lab and load its disposable credentials:

```bash
cp .env.example .env
nvim .env
docker compose up --build -d --wait

set -a
source .env
set +a

export ACCESS_TOKEN="$(curl -fsS \
  -u "$OAUTH_CLIENT_ID:$OAUTH_CLIENT_SECRET" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode 'scope=a2a.discover a2a.invoke' \
  http://127.0.0.1:${OAUTH_PORT:-9000}/token \
  | jq -r '.access_token')"
```

Confirm that push notifications are advertised:

```bash
curl -fsS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://127.0.0.1:${A2A_GATEWAY_PORT:-4000}/a2a/reference-agent/.well-known/agent-card.json \
  | jq '.capabilities.pushNotifications'
```

Start a slow task and register the callback inline. The URL is the receiver's private Compose-network address, not its host observation address:

```bash
REQUEST_ID="push-demo"
RESPONSE="$(curl -fsS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'A2A-Version: 1.0' \
  -H 'Content-Type: application/json' \
  --data "$(jq -nc \
    --arg id "$REQUEST_ID" \
    --arg secret "${PUSH_CALLBACK_TOKEN:-a2a-lab-callback-secret}" \
    '{
      jsonrpc: "2.0",
      id: $id,
      method: "SendMessage",
      params: {
        message: {
          messageId: $id,
          role: "ROLE_USER",
          parts: [{text: "slow 3"}]
        },
        configuration: {
          returnImmediately: true,
          taskPushNotificationConfig: {
            id: "demo-callback",
            url: "http://webhook-receiver:8100/callbacks/a2a",
            authentication: {scheme: "Bearer", credentials: $secret}
          }
        }
      }
    }')" \
  http://127.0.0.1:${A2A_GATEWAY_PORT:-4000}/a2a/reference-agent)"

TASK_ID="$(jq -r '.result.id' <<<"$RESPONSE")"
printf 'accepted task: %s\n' "$TASK_ID"
```

Do not call `GetTask` yet. Observe the receiver until it reports a terminal hint:

```bash
until SNAPSHOT="$(curl -fsS \
  -H "Authorization: Bearer ${PUSH_OBSERVER_TOKEN:-a2a-lab-observer-secret}" \
  "http://127.0.0.1:${PUSH_RECEIVER_PORT:-8100}/notifications?taskId=$TASK_ID")" \
  && jq -e '.currentState == "TASK_STATE_COMPLETED"' <<<"$SNAPSHOT" >/dev/null
do
  sleep 0.2
done

jq '{currentState, notifications: [.notifications[] | {
  deliveryCount,
  variant: (.payload | keys[0])
}]}' <<<"$SNAPSHOT"
```

Now retrieve the authoritative task:

```bash
curl -fsS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'A2A-Version: 1.0' \
  -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg task_id "$TASK_ID" '{
    jsonrpc: "2.0",
    id: "get-after-push",
    method: "GetTask",
    params: {id: $task_id}
  }')" \
  http://127.0.0.1:${A2A_GATEWAY_PORT:-4000}/a2a/reference-agent \
  | jq '{state: .result.status.state, text: .result.artifacts[0].parts[0].text}'
```

Run the repeatable assertions for both implementations:

```bash
bun run test:protocol
bun run test:integration
```

## Expected result

The card prints `true`. `SendMessage` returns a submitted task immediately. The receiver later reports `TASK_STATE_COMPLETED`, and the final `GetTask` prints:

```json
{
  "state": "TASK_STATE_COMPLETED",
  "text": "slept: 3"
}
```

The managed integration registers two callback configurations for each task. The receiver sees two identical terminal HTTP deliveries but retains one semantic event with `deliveryCount: 2`. It also exercises create/get/list/delete configuration methods, verifies read responses redact credentials, and proves that a metadata-service callback URL is rejected.

## Watch it happen

```bash
docker compose logs -f --since=0s \
  agentgateway bridge reference-agent webhook-receiver
```

The receiver logs request paths and status codes through Uvicorn, but not authorization headers or callback bodies. Observation reads require a second lab-only Bearer credential. The integration suite additionally scans service logs for both receiver credentials.

## What the controller is doing

Each A2A implementation wraps its SDK's in-memory push-configuration store with the same narrow policy: only the server-configured callback URL and Bearer credential are accepted. The URL is rechecked immediately before every delivery, redirects are disabled, payloads use `application/a2a+json`, and delivery errors are isolated from task execution.

The receiver authenticates before parsing, enforces a body limit, accepts one recognizable A2A stream-event variant, and fingerprints canonical JSON. Duplicate deliveries increment a count instead of applying the event twice. A terminal observed state cannot be regressed by a later non-terminal event.

Push events are hints. The callback may wake a client or trigger retrieval, but the task store remains the authority. That is why this example ends with an authenticated `GetTask` rather than treating the webhook ledger as canonical state.

## Boundaries

- Delivery is best effort. The installed SDKs and this example have no retries or durable outbox.
- Duplicate-safe receipt is proven; exactly-once and at-least-once delivery are not claimed.
- Ordering is preserved per task within one process. There is no global ordering guarantee across tasks, replicas, failures, or restarts.
- The callback Bearer token proves possession but has no per-event timestamp or nonce. It does not provide replay rejection or cryptographic payload signatures.
- The exact callback allowlist is appropriate for this closed Docker lab. Supporting arbitrary public callback URLs requires stronger SSRF defenses, production HTTPS, certificate policy, egress controls, and DNS-rebinding analysis.
- Tasks, callback registrations, and receiver observations are in memory and disappear on service recreation.
- Gateway authentication protects caller-to-agent requests. Agent-to-receiver callback authentication is a separate boundary and does not pass through agentgateway.
- SDK owner scoping is not wired to gateway JWT identity because the gateway does not forward its token to the backends. Do not treat this lab as production multi-tenant callback isolation.
