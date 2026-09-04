# 06 — Static Bearer Authentication

## What this teaches

An A2A Agent Card can tell clients which authentication scheme the published endpoint requires. The requirement and the enforcement are separate responsibilities: both backend cards declare HTTP Bearer authentication, while agentgateway rejects unauthenticated traffic at the shared listener.

This example uses one fixed, lab-only opaque key. It demonstrates protocol declaration and edge enforcement—not production identity or authorization.

This is a frozen historical stage. Example 07 replaced the current stack's permanent gateway key with OAuth client credentials. To run the exact static-key implementation without changing your current checkout, create a detached worktree at its verified commit:

```bash
git worktree add /tmp/letta-a2a-example-06 a0219be
cd /tmp/letta-a2a-example-06
cp .env.example .env
nvim .env
```

Executed verification is retained in [`docs/evidence/2026-09-03-example-06.md`](../../docs/evidence/2026-09-03-example-06.md).

## Message flow

```text
client ── no/wrong Bearer token ──▶ agentgateway ──▶ 401

client ── valid Bearer token ─────▶ agentgateway
                                    └──▶ backend Agent Card / A2A task
```

## Run it

Start the lab with a known disposable key:

```bash
export A2A_GATEWAY_KEY=sk-a2a-lab-only
docker compose up --build -d --wait
```

Set the published reference-agent card URL:

```bash
CARD_URL=http://127.0.0.1:4000/a2a/reference-agent/.well-known/agent-card.json
```

No credential:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$CARD_URL"
```

Incorrect credential:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'Authorization: Bearer wrong-a2a-lab-key' \
  "$CARD_URL"
```

Valid credential and advertised policy:

```bash
curl -fsS \
  -H "Authorization: Bearer $A2A_GATEWAY_KEY" \
  "$CARD_URL" \
  | jq '{securitySchemes, securityRequirements}'
```

## Expected result

The first two requests return:

```text
401
401
```

The valid request returns a card containing this shape, but never the key itself:

```json
{
  "securitySchemes": {
    "a2aLabBearer": {
      "httpAuthSecurityScheme": {
        "description": "Static lab-only Bearer key enforced by agentgateway.",
        "scheme": "Bearer",
        "bearerFormat": "opaque"
      }
    }
  },
  "securityRequirements": [
    { "schemes": { "a2aLabBearer": {} } }
  ]
}
```

## Watch it happen

Watch only the edge and A2A backends:

```bash
docker compose logs -f --since=0s agentgateway bridge reference-agent
```

Check that the valid key was not logged:

```bash
logs="$(docker compose logs agentgateway bridge reference-agent)"
if grep -Fq -- "$A2A_GATEWAY_KEY" <<<"$logs"; then
  echo 'FAIL: credential appeared in logs'
  exit 1
fi
echo 'PASS: credential absent from logs'
```

The managed protocol and live integration suites perform the same leak check for the valid key, the incorrect test key, the provider credential, and the App Server token. Their failure-log path redacts those values before printing diagnostics.

## What the controller is doing

Each backend Agent Card declares an `a2aLabBearer` HTTP authentication scheme and lists it as a top-level security requirement. Agentgateway preserves those fields while rewriting the invocation URL to the published route.

Agentgateway's strict API-key policy validates `Authorization: Bearer <key>` before forwarding Agent Card or JSON-RPC requests. Clients still receive `401` without the correct key, so they cannot discover the declaration anonymously in this lab; callers receive the scheme name and bootstrap credential out of band.

The Agent Card contains only the scheme type and format hint. The actual credential remains in environment configuration and request headers.

## Boundaries

- One shared static key authenticates every caller; it does not establish per-agent identity.
- There are no scopes or authorization decisions. Example 08 is reserved for that distinction.
- Key issuance, rotation, revocation, expiry, and secure storage are outside this lab example.
- The backend services are private Compose-network implementation details. The declared policy describes their gateway-published endpoints, where enforcement occurs.
- OAuth client credentials are implemented by the current [Example 07](../07-oauth-client-credentials/) stack; this checkpoint remains useful for comparing the permanent-key and short-lived-token designs.
