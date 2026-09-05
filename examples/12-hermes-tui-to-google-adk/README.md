# 12 — Hermes TUI to Google ADK

## What this teaches

A real interactive agent harness can use its own built-in A2A client against a different framework without either side adopting the other's runtime. Hermes supplies `a2a_call`; Google ADK supplies `to_a2a()`; the existing agentgateway remains the OAuth and routing boundary.

The first turn asks the ADK agent to retain a codeword. The second turn passes the context ID returned by Hermes and proves that ADK continued the same in-memory session.

Executed verification is retained in [`docs/evidence/2026-09-04-example-12.md`](../../docs/evidence/2026-09-04-example-12.md).

## Message flow

```text
operator
   │ real terminal
   ▼
Hermes v0.21.0 TUI ── built-in a2a_call + short-lived JWT ──▶ agentgateway
                                                               │
                                                               ▼
                                                    Google ADK 2.8.0 agent
                                                               │
Hermes TUI ◀──────────── completed text task + context ID ─────┘
```

Hermes is attached only to `a2a-clients`. The ADK container is attached only to `a2a-lab`; agentgateway spans both networks. The configured and demonstrated Hermes-to-ADK path therefore cannot resolve the ADK container directly.

## Provider-free verification

The repeatable test uses the real locked ADK service, A2A SDK, OAuth fixture, and gateway with a deterministic ADK model seam. It does not start Hermes or call a model provider:

```bash
bun run test:example-12
```

It verifies the dedicated Hermes identity and 900-second TTL, protected/re-written card, synchronous two-turn context continuation, distinct request/message IDs, shared response context, gateway attribution, stripped backend authorization header, and credential-free logs.

## Run the live TUI walkthrough

Create the lab environment and a disposable Hermes client secret:

```bash
test -f .env || cp .env.example .env
nvim .env

set -a
source .env
set +a

export HERMES_OAUTH_CLIENT_SECRET="$(openssl rand -hex 32)"
export OPENAI_API_KEY_SECRET_FILE="$(mktemp)"
chmod 600 "$OPENAI_API_KEY_SECRET_FILE"
printf '%s' "$OPENAI_API_KEY" > "$OPENAI_API_KEY_SECRET_FILE"
```

Start only the remote ADK path and its dependencies:

```bash
docker compose --profile example-12-live up \
  --build --detach --wait \
  google-adk-agent agentgateway
```

Open Hermes with an attached terminal:

```bash
docker compose --profile example-12-live run --rm --no-deps hermes-tui
```

The provider key is mounted from the temporary file rather than written into either container's configured environment. The launcher performs a client-credentials exchange, verifies the protected Agent Card, writes the reviewed config template to the dedicated Hermes volume, places the access token and provider key only in the Hermes process environment, and `exec`s `hermes --tui` without piping its terminal. The ADK runtime likewise reads the mounted provider key immediately before starting Uvicorn.

Inside the TUI, run:

```text
/tools
```

Confirm that `a2a_call` is present. Then ask:

```text
Use the a2a_call tool exactly once with agent google-adk and message: Remember the codeword COMPASS and reply STORED. Return the remote reply and context ID.
```

Expand the visible `A2a Call` tool event if needed and retain its `ctx-...` value. Continue with that exact opaque value:

```text
Use the a2a_call tool exactly once with agent google-adk, context_id <ctx-from-first-call>, and message: What codeword did I ask you to remember? Return only the remote reply and its context ID.
```

The reply should identify `COMPASS`, and the second tool result should retain the first context ID. Live model wording is not otherwise deterministic.

The access token expires after 900 seconds. Exit and rerun the Compose `run` command to mint a new token; this example deliberately has no hidden refresh daemon.

## Automated live proof

The opt-in live check uses Hermes one-shot mode so it can run unattended while exercising the same built-in `a2a_call` tool, named peer, OAuth launcher, gateway route, and live ADK model:

```bash
bun run test:example-12:live
```

It requires `OPENAI_API_KEY`, defaults Hermes to `gpt-5-mini`, defaults ADK to `openai/gpt-4.1-nano`, runs two distinct model turns with one context, obtains the continuation ID from Hermes's authoritative A2A conversation-state filename rather than model prose, checks Hermes's A2A audit file, inspects gateway/ADK correlation records, and removes its unique Compose project and volumes.

## Inspect correlation without exposing prompts or credentials

Gateway records identify the route, authenticated subject, method, task state, and context ID. ADK records contain only request ID, message ID, input/output context IDs, and whether an authorization header reached the backend:

```bash
docker compose --profile example-12-live logs --no-color \
  agentgateway google-adk-agent \
  | rg 'google_adk_a2a_request|a2a.context.id'
```

Hermes's bundled A2A plugin writes its own outbound audit records:

```bash
docker compose --profile example-12-live run --rm --no-deps \
  --entrypoint /bin/sh hermes-tui \
  -c 'tail -n 20 /opt/data/a2a_audit.jsonl'
```

These records establish three different things:

- Hermes's audit identifies the stock `google-adk` peer and tool-owned A2A task ID.
- agentgateway identifies the OAuth subject, routed backend, completed task, and shared context ID.
- the ADK observation identifies distinct request/message IDs and proves `preserveToken: false` stripped the gateway Bearer token before backend delivery.

## Cleanup

```bash
docker compose --profile example-12-live down --volumes --remove-orphans
rm -f "$OPENAI_API_KEY_SECRET_FILE"
unset OPENAI_API_KEY_SECRET_FILE
unset HERMES_OAUTH_CLIENT_SECRET
```

## Boundaries

- The release image is pinned to Hermes Agent `v0.21.0` / `v2026.8.31` at OCI index digest `sha256:64923faeae267792bf9bf87fe3b4c4869e35004e360c7df01730ad801b74d524`.
- The A2A plugin is explicitly opted in as `a2a-platform`, and only the `cli` tool surface enables its `a2a` toolset. Hermes's inbound A2A platform remains disabled.
- `a2a_discover(url)` cannot attach the named-peer token in this Hermes release. Use `a2a_call` with the configured `google-adk` peer.
- The launcher and repository never persist the access token. Provider credentials enter through a temporary read-only secret-file mount rather than image layers or configured container environment. A local operator with Docker control can still inspect mounts, process environments, and the auth-server's lab-only client-secret environment; this is not a production secret-isolation design.
- The gateway authorizes invocation by issuer, audience, role, scope, method, and path shape. It does not bind the Hermes subject exclusively to the ADK route or own ADK context IDs.
- Google ADK's OAuth declaration describes gateway enforcement; the backend itself does not validate Bearer tokens. Network separation and the gateway route are part of this closed lab boundary.
- ADK sessions and tasks are in memory and disappear when `google-adk-agent` is recreated. One Uvicorn worker is intentional.
- Hermes waits synchronously for `SendMessage`. This example does not demonstrate A2A streaming, task polling, push notifications, or cancellation.
