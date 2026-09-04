# Example 11 implementation plan

## Goal

Demonstrate the A2A push-notification use case without turning the lab into a production webhook platform: a caller starts an asynchronous task, registers an authenticated callback, stops polling the task, receives a later terminal notification, and then uses `GetTask` as the authoritative read.

## Acceptance criteria

1. Both gateway-published Agent Cards advertise push notifications only after their handlers have a working store and sender.
2. The Letta bridge and Python reference agent accept A2A 1.0 push configuration through both inline `SendMessage` configuration and `CreateTaskPushNotificationConfig`.
3. Registrations are restricted to the one server-configured lab callback URL, require canonical Bearer authentication, reject legacy token ambiguity, and disable redirects during delivery.
4. A separate Dockerized receiver rejects missing or incorrect callback credentials, bounds and validates payloads, authenticates observation reads with a separate credential, and never stores either credential.
5. The receiver deduplicates identical deliveries by canonical payload fingerprint and never lets a late non-terminal event regress a terminal observed state.
6. The deterministic protocol test starts a slow task, receives its initial task response, does not poll it while running, receives a terminal webhook, and only then retrieves the authoritative task.
7. Two registered configurations deliberately deliver the same event twice, proving duplicate-safe receiver behavior without claiming sender retries.
8. The provider-backed suite proves the same terminal push path from a Letta task while preserving all earlier streaming, delegation, and cancellation behavior.
9. Callback credentials do not appear in Agent Cards, callback bodies, observation responses, or inspected service logs.

## Design

```text
A2A caller ── OAuth/JWT ──▶ agentgateway ──▶ A2A agent
     │                                            │
     │ initial Task response                     │ authenticated POST
     │ (no task polling)                         ▼
     └─────────────────────────────── webhook-receiver
                                                  │
                         terminal hint ───────────┘
     │
     └── authenticated GetTask ──▶ authoritative result
```

### Registration boundary

Each agent gets a validating in-memory push-configuration store. It accepts only:

- the exact configured callback URL;
- no URL credentials, query, or fragment;
- `authentication.scheme = Bearer` with the configured lab credential;
- an empty legacy `token` field;
- a blank task ID for inline registration or the exact task ID for standalone registration.

The demonstrated registration and delivery path uses A2A 1.0. The example does not claim push-callback compatibility for the retained legacy 0.3 interface.

This exact deployment allowlist is the lab's SSRF boundary. It is intentionally narrower than attempting to safely support arbitrary Internet callback URLs.

### Delivery boundary

Both senders serialize the canonical A2A 1.0 `StreamResponse`, send `Content-Type: application/a2a+json`, use the Bearer credential, disable redirects, apply a short timeout, and preserve event order per task. Delivery failure is logged without credentials and never changes the A2A task result.

The SDKs provide no retry/outbox guarantee. This example therefore proves best-effort authenticated delivery and duplicate-safe consumption, not at-least-once or exactly-once delivery.

### Receiver boundary

The receiver is a deterministic fixture, not a general webhook product. It is reachable on the private Compose network and published only to host loopback for test observation. It stores canonical payload fingerprints, safe metadata, delivery counts, and a monotonic observed state. `GetTask`, not the webhook ledger, remains authoritative.

## Test-first slices

1. Failing card tests requiring `pushNotifications=true`.
2. Failing TypeScript and Python store-policy tests for allowed and forbidden registrations.
3. Failing sender tests for Bearer headers, A2A content type, redirect refusal, ordering, and failure isolation.
4. Failing receiver tests for authentication, payload bounds, deduplication, and terminal-state monotonicity.
5. Wire stores/senders into both SDK request handlers.
6. Add the receiver service and integration helpers.
7. Prove provider-free and provider-backed push flows, then update Example 11 documentation and evidence.

## Explicit non-goals

- arbitrary callback destinations;
- public HTTPS deployment or certificate management;
- durable task/config/outbox storage;
- automatic retries or exactly-once delivery;
- cryptographic per-payload signatures, freshness, or replay rejection;
- production tenant/task ownership isolation;
- horizontal replicas or global ordering.
