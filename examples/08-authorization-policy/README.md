# 08 — Authorization Policy

## What this teaches

Authentication answers **who called**. Authorization answers **what that caller may do**. This example gives the shell operator, bridge, external reference agent, observer, and intentionally denied invoker distinct OAuth client identities. The authorization server places each registered client's trusted role and granted scopes in its signed JWT.

Agentgateway then applies a fail-closed allowlist:

- `GET .../.well-known/agent-card.json` requires `a2a.discover`.
- A2A JSON-RPC `POST` requires `a2a.invoke` and a trusted `operator` or `agent` role.
- Everything else is denied.

The policy is deterministic gateway configuration. No model is asked to decide whether a caller is authorized.

This is a frozen historical stage. Example 09 enabled streaming while retaining this authorization policy. To run the exact pre-streaming implementation without changing your current checkout, create a detached worktree at its verified commit:

```bash
git worktree add /tmp/letta-a2a-example-08 7bfd16b
cd /tmp/letta-a2a-example-08
cp .env.example .env
nvim .env
```

Remove that detached worktree when finished:

```bash
git worktree remove /tmp/letta-a2a-example-08
```

Executed verification is retained in [`docs/evidence/2026-09-04-example-08.md`](../../docs/evidence/2026-09-04-example-08.md).

## Message flow

```text
OAuth client ── credentials + requested scopes ──▶ authorization server
             ◀── signed JWT: sub + role + scope ──┘

JWT ──▶ agentgateway
         ├─ valid signature/claims? no ─────────────▶ 401
         ├─ GET card + a2a.discover? yes ──────────▶ Agent Card
         ├─ POST + a2a.invoke + operator/agent? yes ▶ A2A backend
         └─ authenticated but not allowed ─────────▶ 403
```

## Run it

Start the current lab:

```bash
cp .env.example .env
nvim .env
docker compose up --build -d --wait

set -a
source .env
set +a
```

Define a small token helper:

```bash
token() {
  curl -fsS \
    -u "$1:$2" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=client_credentials' \
    --data-urlencode "scope=$3" \
    http://127.0.0.1:9000/token \
    | jq -r '.access_token'
}

export OPERATOR_TOKEN="$(token \
  "$OAUTH_CLIENT_ID" "$OAUTH_CLIENT_SECRET" \
  'a2a.discover a2a.invoke')"
export OPERATOR_INVOKE_TOKEN="$(token \
  "$OAUTH_CLIENT_ID" "$OAUTH_CLIENT_SECRET" \
  'a2a.invoke')"
export OBSERVER_TOKEN="$(token \
  "$OAUTH_OBSERVER_CLIENT_ID" "$OAUTH_OBSERVER_CLIENT_SECRET" \
  'a2a.discover')"
export DENIED_TOKEN="$(token \
  "$OAUTH_DENIED_CLIENT_ID" "$OAUTH_DENIED_CLIENT_SECRET" \
  'a2a.invoke')"
```

Inspect the identity-bearing claims without printing client secrets:

```bash
for name in OPERATOR_TOKEN OBSERVER_TOKEN DENIED_TOKEN; do
  NAME="$name" node -e '
    const claims = JSON.parse(Buffer.from(process.env[process.env.NAME].split(".")[1], "base64url"));
    console.log(process.env.NAME, { sub: claims.sub, role: claims.role, scope: claims.scope });
  '
done
```

Compare discovery access:

```bash
CARD_URL=http://127.0.0.1:4000/a2a/reference-agent/.well-known/agent-card.json

curl -sS -o /dev/null -w 'observer card: %{http_code}\n' \
  -H "Authorization: Bearer $OBSERVER_TOKEN" "$CARD_URL"

curl -sS -o /dev/null -w 'operator without discover: %{http_code}\n' \
  -H "Authorization: Bearer $OPERATOR_INVOKE_TOKEN" "$CARD_URL"
```

Compare invocation access using a harmless request for a nonexistent task:

```bash
RPC_URL=http://127.0.0.1:4000/a2a/reference-agent
RPC_BODY='{"jsonrpc":"2.0","id":"authz-demo","method":"GetTask","params":{"id":"does-not-exist"}}'

for pair in "observer:$OBSERVER_TOKEN" "denied:$DENIED_TOKEN" "operator:$OPERATOR_TOKEN"; do
  name="${pair%%:*}"
  bearer="${pair#*:}"
  curl -sS -o /dev/null -w "$name RPC: %{http_code}\n" \
    -H "Authorization: Bearer $bearer" \
    -H 'Content-Type: application/json' \
    --data "$RPC_BODY" \
    "$RPC_URL"
done
```

Run a real operator-authorized task and the deterministic policy matrix:

```bash
bun run smoke reference-agent 'echo AUTHORIZATION_OK'
bun run test:protocol
```

## Expected result

The decoded tokens have distinct subjects and server-assigned roles:

```text
OPERATOR_TOKEN { sub: 'operator-client', role: 'operator', scope: 'a2a.discover a2a.invoke' }
OBSERVER_TOKEN { sub: 'observer-client', role: 'observer', scope: 'a2a.discover' }
DENIED_TOKEN   { sub: 'denied-invoker-client', role: 'untrusted', scope: 'a2a.invoke' }
```

The HTTP decisions are:

```text
observer card:              200
operator without discover:  403
observer RPC:                403
denied RPC:                  403
operator RPC:                200
```

The operator RPC receives HTTP `200` because it reached the A2A backend; its JSON-RPC body still reports that the synthetic task ID does not exist. The smoke task completes with `AUTHORIZATION_OK`.

The managed protocol suite additionally proves that an observer cannot obtain `a2a.invoke` from the authorization server and that missing, malformed, wrong-signature, and expired tokens still receive `401` rather than `403`.

## Watch it happen

```bash
docker compose logs -f --since=0s auth-server agentgateway bridge reference-agent
```

Agentgateway's structured request records expose verified JWT claims such as `jwt.sub`; they do not forward the Bearer token to the backend because `preserveToken` is explicitly false. The integration suite separately checks service logs for every tested secret and token.

## What the controller is doing

The local authorization server owns the client registry. Callers can request only scopes assigned to their registration; they cannot submit their own role. The signed JWT carries `sub`, `client_id`, `role`, and a canonical space-delimited `scope` claim.

The shell client uses the `operator` role. The TypeScript bridge and Python reference agent use separate credentials with the `agent` role, so nested delegation does not depend on the shell operator's identity. The observer receives only `a2a.discover`. The denied invoker deliberately receives `a2a.invoke` but an untrusted role, proving that possession of a scope alone is insufficient.

Agentgateway first authenticates the JWT, then evaluates two CEL allow rules. Because at least one `allow` rule exists, unmatched requests are denied. Invalid tokens fail authentication with `401`; valid tokens that do not satisfy an allow rule fail authorization with `403`.

Both Agent Cards list the available `a2a.discover` and `a2a.invoke` scopes in their OAuth2 client-credentials flow. Their top-level A2A security requirement still names `a2a.invoke`, because that is the permission required to use the advertised agent. Discovery authorization is bootstrapped out of band before the card can be read.

## Boundaries

- Roles and clients are fixed educational registrations in an in-memory authorization server, not a production identity directory.
- `role` is a custom signed claim trusted only because agentgateway pins this issuer and JWKS.
- All current JSON-RPC methods share `a2a.invoke`; this example does not define per-method task ownership or read/write scopes.
- The observer may discover every configured agent. Per-agent tenant or resource authorization is not implemented.
- Revocation, credential rotation, consent, end-user login, and durable audit storage remain outside the lab.
- Default credentials are disposable and visible in local Compose configuration. The entire lab remains loopback-only.

Policy semantics follow agentgateway's [HTTP authorization](https://agentgateway.dev/docs/standalone/latest/configuration/security/http-authz/) and [CEL variable](https://agentgateway.dev/docs/standalone/latest/reference/cel/variables/) documentation.
