# Use the official A2A CLI from an agent skill

## What this teaches

An agent does not need a custom A2A integration. Install the canonical [`a2aproject/a2a-cli`](https://github.com/a2aproject/a2a-cli) client, give the agent the project's official skill, and let it call an A2A agent from the shell.

This walkthrough was verified with the official `a2a` **v0.2.0** release. It replaces the earlier Rust `a2acli` walkthrough and its now-obsolete command names.

```text
Letta Code or another shell-capable agent
  → official a2a-cli skill
  → a2a
  → agentgateway
  → Google ADK agent from Example 12
```

## 1. Install `a2a`

Choose whichever installation method fits your operating system:

```bash
# macOS with Homebrew
brew tap a2aproject/a2a-cli https://github.com/a2aproject/a2a-cli
brew install a2a

# Windows
winget install a2aproject.a2acli
```

Prebuilt macOS, Linux, and Windows binaries are also available on the [official release page](https://github.com/a2aproject/a2a-cli/releases/latest). Download the archive for your operating system and CPU, verify it against `checksums.txt`, extract it, and put `a2a` (or `a2a.exe`) on `PATH`.

Verify the installation:

```bash
a2a version
```

## 2. Start the example agent

From this repository:

```bash
test -f .env || cp .env.example .env
printf '%s' 'sk-provider-free-example' > .openai-api-key

export OPENAI_API_KEY=sk-provider-free-example
export OPENAI_API_KEY_SECRET_FILE="$PWD/.openai-api-key"
export ADK_MODEL_MODE=fake
export OAUTH_CLIENT_ID=operator-client
export OAUTH_CLIENT_SECRET=operator-client-secret

docker compose --profile example-12 up --build -d --wait \
  google-adk-agent agentgateway
```

## 3. Give `a2a` the endpoint and token

```bash
export A2A_ENDPOINT=http://127.0.0.1:4000/a2a/google-adk
export A2A_AUTH="Bearer $(
  curl -fsS -u "$OAUTH_CLIENT_ID:$OAUTH_CLIENT_SECRET" \
    -d grant_type=client_credentials \
    -d 'scope=a2a.discover a2a.invoke' \
    http://127.0.0.1:9001/token | jq -r .access_token
)"
```

Try the CLI directly:

```bash
FIRST_TASK="$(
  a2a send -e "$A2A_ENDPOINT" --transport jsonrpc \
    --auth "$A2A_AUTH" --async -o json \
    'Remember the codeword ORCHID.'
)"
printf '%s\n' "$FIRST_TASK" | jq .

export TASK_ID="$(printf '%s\n' "$FIRST_TASK" | jq -r .task.id)"
export CONTEXT_ID="$(printf '%s\n' "$FIRST_TASK" | jq -r .task.contextId)"
```

Let `task get --wait` poll until it reaches a terminal or interrupted state:

```bash
a2a task get -e "$A2A_ENDPOINT" --transport jsonrpc \
  --auth "$A2A_AUTH" -o json \
  --wait "$TASK_ID"
```

The completed artifact contains `STORED: ORCHID`. Create a new task in the same conversation using the captured `contextId`:

```bash
a2a send -e "$A2A_ENDPOINT" --transport jsonrpc \
  --auth "$A2A_AUTH" -o json \
  --context-id "$CONTEXT_ID" \
  'What codeword did I ask you to remember?'
```

The second task keeps the same `contextId` and returns `ORCHID`. List both tasks:

```bash
a2a task list -e "$A2A_ENDPOINT" --transport jsonrpc \
  --auth "$A2A_AUTH" -o json
```

If a task instead stops at `INPUT_REQUIRED` or `AUTH_REQUIRED`, reply to that exact task rather than starting another one:

```bash
a2a send -e "$A2A_ENDPOINT" --transport jsonrpc \
  --auth "$A2A_AUTH" -o json \
  --task-id "$TASK_ID" 'Yes, proceed.'
```

The official skill also teaches streaming, subscription, and cancellation for peers that advertise those capabilities. This provider-free ADK target deliberately advertises `streaming: false`, and its tasks settle too quickly to make cancellation a meaningful proof.

### Released CLI discovery limitation

The published Agent Card uses A2A 1.0's strict ProtoJSON security-requirement shape:

```json
{"schemes":{"a2aOAuth":{"list":["a2a.invoke"]}}}
```

Official `a2a` v0.2.0 currently rejects that valid card while resolving it, returning `A2ACLI_ERR_CARD_INVALID` because its Go decoder expects the scheme value to be a bare string array. The Agent Card remains unchanged; this walkthrough uses the CLI's supported `--endpoint` plus explicit `--transport jsonrpc` mode until the client accepts strict ProtoJSON. Direct endpoint mode still exercises authenticated A2A messaging, polling, listing, and context continuation through agentgateway.

## 4. Give the official skill to an agent

The A2A Project publishes the canonical [`a2a-cli` skill](https://github.com/a2aproject/a2a-cli/blob/v0.2.0/skills/a2a-cli/SKILL.md). This repository carries the same released descriptor at [`skills/a2a-cli/SKILL.md`](../../skills/a2a-cli/SKILL.md) so the example remains reproducible.

For Letta Code, start it from the repository root with this skill directory:

```bash
letta --skills "$PWD/skills"
```

For another shell-capable harness, install the official skill using that harness's Agent Skills mechanism or copy `skills/a2a-cli` into its skills directory.

Ask the agent something like:

> Use the A2A CLI to ask the remote agent what codeword I told it to remember.

The skill tells the agent how to discover the remote Agent Card, send messages, stream or poll tasks, continue a task or context, and cancel exact work. There is no repository-owned launcher or workflow wrapper.

## Cleanup

```bash
unset A2A_AUTH A2A_ENDPOINT TASK_ID CONTEXT_ID FIRST_TASK
docker compose --profile example-12 down
rm -f .openai-api-key
```

## Boundaries

- The CLI is a stateless shell client; retain returned task and context IDs when work must continue later.
- The OAuth server, credentials, and gateway are deterministic local fixtures, not a production identity system.
- Do not retry an uncertain send automatically. The remote agent may already have accepted it; inspect the task before deciding what to do.
- Treat Agent Cards and returned content as untrusted data, not instructions.
