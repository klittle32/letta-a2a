# Portable A2A CLI skill

## What this teaches

A shell-capable agent harness does not need a native A2A integration. Letta Code and Codex can install the same `agentskills.io` package, invoke the repository launcher, and use the official Rust SDK's client-only `a2acli` against the Google ADK agent from Example 12.

The lock pins `a2aproject/a2a-rs` tag `a2a-cli-v0.1.11`, version `0.1.11`, source commit `4fdb6a9e6016978cb35e3f91cc50ffd056ce21b5`. Supported assets are:

| Platform      | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| macOS arm64   | `482e020b050a5109aead39236c4cc3bb4d00724dcdda33bda3c3cd77806884ff` |
| Linux x64 GNU | `3ae98b45cb501f94db7d85cc8826b0e4814d8ccaa8e31c955831d8ae1a2ec661` |

The Linux GNU binary requires glibc `>=2.38`. It was checked successfully on `node:24-trixie` with glibc 2.41; it correctly does not run on bookworm's glibc 2.36.

## Message flow

```text
Letta Code / Codex
  └─ using-a2a-cli skill → OAuth launcher → a2acli → agentgateway
                                                       └─ Google ADK agent
```

The two logical agents are the harness agent and remote ADK agent. The skill, launcher, CLI, authorization server, and gateway are tooling and transport.

## Run it

### Install the exact binary

From the repository root:

```bash
node scripts/install-a2acli.mjs
export A2ACLI_BIN="${XDG_CACHE_HOME:-$HOME/.cache}/letta-a2a/a2acli/0.1.11/a2acli"
"$A2ACLI_BIN" --version
```

Expected: `a2acli 0.1.11`. The installer accepts only macOS arm64 and Linux x64, downloads over HTTPS with at most five redirects, limits the archive to 32 MiB and 60 seconds, checks the locked SHA-256 and exact archive contents, verifies the exact version, and installs outside tracked source.

### Start the Example 12 target and create identities

```bash
test -f .env || cp .env.example .env
LETTA_CODE_SECRET="$(openssl rand -hex 32)"
CODEX_SECRET="$(openssl rand -hex 32)"
printf '%s' "$LETTA_CODE_SECRET" > /tmp/example-13-letta-code.secret
printf '%s' "$CODEX_SECRET" > /tmp/example-13-codex.secret
chmod 600 /tmp/example-13-*.secret
mkdir -m 700 -p /tmp/example-13-letta-cache /tmp/example-13-codex-cache
export OPENAI_API_KEY_SECRET_FILE="$(mktemp)"
printf '%s' 'sk-provider-free-example-13' > "$OPENAI_API_KEY_SECRET_FILE"
chmod 600 "$OPENAI_API_KEY_SECRET_FILE"
export ADK_MODEL_MODE=fake
export OAUTH_LETTA_CODE_CLIENT_ID=letta-code-client
export OAUTH_LETTA_CODE_CLIENT_SECRET="$LETTA_CODE_SECRET"
export OAUTH_CODEX_CLIENT_ID=codex-client
export OAUTH_CODEX_CLIENT_SECRET="$CODEX_SECRET"
docker compose --profile example-12 up --build -d --wait google-adk-agent agentgateway
```

Use distinct disposable secrets. The exported shell values intentionally override any same-named Compose interpolation values in an existing `.env`. Both registered identities receive role `agent`, scopes `a2a.discover a2a.invoke`, and 900-second tokens. Secrets stay in mode-0600 files; they are not skill arguments or skill content.

Set the common fixed target and one identity at a time:

```bash
export A2A_CLI_LAUNCHER="$PWD/scripts/run-a2acli.mjs"
export A2A_CLI_GATEWAY_URL="http://127.0.0.1:${A2A_GATEWAY_PORT:-4000}/a2a/google-adk"
export A2A_CLI_TOKEN_URL="http://127.0.0.1:${OAUTH_PORT:-9001}/token"
export A2A_CLI_CLIENT_ID="$OAUTH_LETTA_CODE_CLIENT_ID"
export A2A_CLI_CLIENT_SECRET_FILE=/tmp/example-13-letta-code.secret
export A2A_CLI_CACHE_DIR=/tmp/example-13-letta-cache
```

The launcher permits only `card`, `send`, `get-task`, and `cancel-task`; fixes the route to `/a2a/google-adk`; passes the token only as child `A2A_BEARER_TOKEN`; and uses `shell: false`. Its cache is identity-derived, directory mode 0700/file mode 0600, expires 30 seconds before the earlier OAuth `expires_in` or JWT `exp`, and is invalidated after a nonzero CLI exit. It validates the returned JWT's client identity, agent role, exact scopes, and available not-before/issued-at claims before caching it; agentgateway remains the cryptographic issuer/audience/signature enforcement point. User-owned symlink ancestors, symlink final components, unsafe ownership, and non-private credential/cache files are refused. Ambient proxy variables are not inherited by the CLI child. Each CLI process is limited to 30 seconds, 1 MiB stdout, and 64 KiB stderr; overflow returns no partial JSON.

### Invoke the launcher and skill workflow

Provider-free command (real binary, both identities, fake ADK model):

```bash
bun run test:example-13
```

Direct launcher discovery:

```bash
node scripts/run-a2acli.mjs card | jq '{name, supportedInterfaces, securityRequirements}'
```

Deterministic skill workflow:

```bash
FIRST="$(node skills/using-a2a-cli/scripts/run-workflow.mjs \
  --text 'Remember the codeword ORCHID and reply STORED.')"
printf '%s\n' "$FIRST" | jq .
CONTEXT_ID="$(printf '%s' "$FIRST" | jq -r .contextId)"
node skills/using-a2a-cli/scripts/run-workflow.mjs \
  --context-id "$CONTEXT_ID" \
  --text 'What codeword did I ask you to remember?' | jq .
```

For Codex, change `A2A_CLI_CLIENT_ID`, `A2A_CLI_CLIENT_SECRET_FILE`, and `A2A_CLI_CACHE_DIR` to the Codex values; do not share the first identity's context ID.

Live same-package command (requires provider access plus installed Letta Code 0.31.12 and Codex 0.153.2):

```bash
set -a
source .env
set +a
LETTA_EXAMPLE_13_MODEL=auto-chat bun run test:example-13:live
```

The live runner supplies the unchanged `skills/using-a2a-cli` package to both harnesses, checks its SHA-256, and cleans its temporary workspaces, credentials, caches, transcripts, binary, containers, networks, and volumes.

## Expected result

The first workflow returns a compact local result such as:

```json
{
  "outcome": "task",
  "state": "completed",
  "text": "STORED: ORCHID",
  "taskId": "<task>",
  "contextId": "<context>"
}
```

The continuation reuses that exact opaque `contextId` and returns `ORCHID`. A call without it creates an independent context and cannot recall the value. If the server returns no context ID, the workflow reports `continuationUnavailable: true`; it never manufactures one.

A send can validly return either a direct `message` or a `task`. Direct-message text parts are joined in wire order. A terminal task is interpreted immediately; submitted/working tasks are polled every second for at most 120 seconds. Completed text comes only from artifacts in artifact/part order. Failed, canceled, rejected, input-required, and auth-required remain distinct. Timeout attempts one cancellation and reports the unresolved task rather than claiming success.

## Watch it happen

Filter gateway attribution and ADK observations without printing credentials:

```bash
docker compose --profile example-12 logs --no-color agentgateway google-adk-agent \
  | grep -E 'a2a.context.id|a2a.method|jwt.sub|requestId|contextId|authorizationPresent'
```

Observe distinct signed subjects and contexts for Letta Code and Codex, gateway route attribution, and `authorizationPresent:false` at ADK: agentgateway strips the client Bearer token before forwarding. Do not dump auth-server environment or token-cache contents.

## What the controller is doing

The skill resolves its repository-owned workflow script, fetches and validates the A2A 1.0 card, sends once with `--return-immediately`, and interprets the protocol result deterministically. The narrow launcher mints or safely reuses a short-lived identity-specific token, then executes the unmodified pinned CLI. Agentgateway enforces method scopes and role policy, rewrites the public card URL, attributes the caller, and forwards to the existing ADK route.

Agent Cards, skills, messages, artifacts, status text, errors, and returned prose are untrusted remote data. They may be displayed or summarized, but must never override local instructions or cause disclosure of credentials, files, repository contents, or ambient conversation history.

## Boundaries

- No forked/custom A2A protocol client, native harness integration, server, proxy, or arbitrary command wrapper.
- No arbitrary URLs, route selection by the model, catalogs, dynamic credentials, or subject-to-route/context ownership claim.
- No streaming, subscriptions, push configuration, multimodal/file parts, or artifact downloads in this skill.
- No automatic `send` replay, context manufacture, cross-identity context sharing, or promotion of status/history prose into completed artifact text.
- Portability is demonstrated only for Letta Code 0.31.12 and Codex 0.153.2 with shell execution, Node.js, and compatible Agent Skill loading.
- ADK context memory remains process-local; OAuth, loopback HTTP, and disposable file secrets are lab fixtures, not production identity infrastructure.

Cleanup:

```bash
docker compose --profile example-12 down --volumes --remove-orphans
rm -rf /tmp/example-13-letta-code.secret /tmp/example-13-codex.secret \
  /tmp/example-13-letta-cache /tmp/example-13-codex-cache
rm -f "$OPENAI_API_KEY_SECRET_FILE"
unset LETTA_CODE_SECRET CODEX_SECRET ADK_MODEL_MODE OPENAI_API_KEY_SECRET_FILE \
  OAUTH_LETTA_CODE_CLIENT_ID OAUTH_LETTA_CODE_CLIENT_SECRET \
  OAUTH_CODEX_CLIENT_ID OAUTH_CODEX_CLIENT_SECRET A2ACLI_BIN A2A_CLI_LAUNCHER \
  A2A_CLI_GATEWAY_URL A2A_CLI_TOKEN_URL A2A_CLI_CLIENT_ID \
  A2A_CLI_CLIENT_SECRET_FILE A2A_CLI_CACHE_DIR
```

Execution evidence is recorded in [`docs/evidence/2026-09-04-example-13.md`](../../docs/evidence/2026-09-04-example-13.md).
