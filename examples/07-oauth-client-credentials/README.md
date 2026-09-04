# 07 — OAuth Client Credentials

## What this teaches

Server-to-server A2A callers should obtain short-lived access tokens instead of sending one permanent gateway key. In this example, a caller authenticates to a small local OAuth authorization server, requests the `a2a.invoke` scope, and sends the returned JWT as an HTTP Bearer token.

Agentgateway verifies the JWT signature against the authorization server's JWKS, checks issuer, audience, time claims, and subject, then requires the scope declared by the Agent Card. No browser or end-user login is involved.

This is a frozen historical stage. Example 08 gave callers distinct identities and added authorization policy. To run this exact shared-identity OAuth implementation without changing your current checkout, create a detached worktree at its verified commit:

```bash
git worktree add /tmp/letta-a2a-example-07 8122018
cd /tmp/letta-a2a-example-07
cp .env.example .env
nvim .env
```

Executed verification is retained in [`docs/evidence/2026-09-04-example-07.md`](../../docs/evidence/2026-09-04-example-07.md).

## Message flow

```text
calling agent ── client ID + secret ──▶ authorization server :9000
              ◀── short-lived JWT with a2a.invoke ──────────┘

calling agent ── Authorization: Bearer <JWT> ──▶ agentgateway :4000
                                                  ├─ verify JWKS signature
                                                  ├─ check iss / aud / exp / nbf / sub
                                                  ├─ require a2a.invoke
                                                  └─▶ selected A2A backend
```

## Run it

Start the current lab:

```bash
cp .env.example .env
nvim .env
docker compose up --build -d --wait
```

Load the disposable lab credentials from `.env`, then perform the client-credentials exchange:

```bash
set -a
source .env
set +a

TOKEN_RESPONSE="$(curl -fsS \
  -u "${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_SECRET}" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode 'scope=a2a.invoke' \
  http://127.0.0.1:9000/token)"

export ACCESS_TOKEN="$(jq -r '.access_token' <<<"$TOKEN_RESPONSE")"
jq '{token_type, expires_in, scope}' <<<"$TOKEN_RESPONSE"
```

Inspect the signed JWT claims locally without printing the client secret:

```bash
node -e '
const claims = JSON.parse(Buffer.from(process.env.ACCESS_TOKEN.split(".")[1], "base64url"));
console.log(JSON.stringify(claims, null, 2));
'
```

Use the token to fetch the gateway-published Agent Card:

```bash
CARD_URL=http://127.0.0.1:4000/a2a/reference-agent/.well-known/agent-card.json
curl -fsS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "$CARD_URL" \
  | jq '{securitySchemes, securityRequirements}'
```

The reusable smoke client performs the same exchange before sending and polling an A2A task:

```bash
bun run smoke reference-agent 'echo OAUTH_A2A_OK'
```

Run the deterministic rejection and protocol matrix:

```bash
bun run test:protocol
```

## Expected result

The token response contains a Bearer token, its short lifetime, and the granted scope:

```json
{
  "token_type": "Bearer",
  "expires_in": 60,
  "scope": "a2a.invoke"
}
```

The decoded access token includes these important claims:

```json
{
  "iss": "http://127.0.0.1:9000",
  "aud": "letta-a2a-gateway",
  "sub": "a2a-lab-client",
  "scope": "a2a.invoke",
  "iat": 0,
  "nbf": 0,
  "exp": 0
}
```

The actual time values differ on every exchange. The Agent Card advertises `a2aOAuth`, its client-credentials token URL and metadata URL, and the required `a2a.invoke` scope. The smoke task completes with `OAUTH_A2A_OK` in its text artifact.

The managed protocol test also proves:

```text
missing token       -> 401
malformed JWT       -> 401
wrong signature     -> 401
expired JWT         -> 401
wrong scope         -> 403
valid scoped JWT    -> backend Agent Card and JSON-RPC response
invalid client      -> OAuth token endpoint 401
```

## Watch it happen

Watch token issuance, authenticated gateway decisions, and A2A traffic without dumping credentials:

```bash
docker compose logs -f --since=0s auth-server agentgateway bridge reference-agent
```

Agentgateway's structured records include `jwt.sub` after successful authentication. The local authorization server's ordinary access log shows token requests but not their form body or Basic credential header.

## What the controller is doing

The TypeScript bridge and Python reference agent each own a client-credentials token provider. A provider caches a token until it nears expiry, deduplicates concurrent exchanges, and reacquires a token before later Agent Card, `SendMessage`, `GetTask`, or `CancelTask` requests. Client secrets go only to the token endpoint; A2A requests carry only access tokens.

The authorization server generates an ephemeral RSA signing key at startup and publishes the public key at `/jwks`. Agentgateway loads that JWKS and validates tokens locally. Its default `preserveToken: false` behavior prevents the gateway access token from being forwarded to backend agents.

Both backend Agent Cards use the canonical A2A 1.0 OAuth2 security shape: an `oauth2SecurityScheme`, a `clientCredentials` flow, and a top-level security requirement listing `a2a.invoke`.

## Boundaries

- The authorization server is a deterministic local fixture, not a production identity provider. Its signing key and client registry are in memory and restart with the container.
- The lab uses plain HTTP on loopback. A real OAuth authorization server and public A2A endpoint require HTTPS.
- Agent Card discovery is itself protected, so a caller must learn the authorization-server location and bootstrap client credentials out of band before it can fetch the card.
- Cards advertise the host-visible loopback token URL. The two Compose-internal callers use the equivalent private `http://auth-server:9000/token` route from environment configuration.
- At this checkpoint, the bridge, reference agent, and shell client intentionally share one disposable client identity. This proves authentication but not differentiated caller identity.
- At this checkpoint, the single `a2a.invoke` scope protects every A2A route. The current [Example 08](../08-authorization-policy/) stack adds caller-aware authorization and distinct permissions.
- Client credentials have no refresh token. A caller repeats the credentials exchange when its access token nears expiry.
- Default credentials are readable from the local Compose configuration. Do not reuse them or this fixture unchanged outside the isolated lab.
