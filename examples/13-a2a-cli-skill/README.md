# Use A2A from an agent skill

## What this teaches

An agent does not need a custom A2A integration. Install the official `a2acli`, give the agent a small skill explaining the commands, and let it call an A2A agent from the shell.

```text
Letta Code or another shell-capable agent
  → using-a2a-cli skill
  → a2acli
  → agentgateway
  → Google ADK agent from Example 12
```

## 1. Install a2acli

Choose whichever installation method fits your operating system:

```bash
# macOS with Homebrew
brew install a2aproject/a2a-rs/a2acli

# Any OS with Rust installed
cargo install a2a-cli
```

Prebuilt macOS, Linux, and Windows binaries are also available on the [official release page](https://github.com/a2aproject/a2a-rs/releases). Download the archive for your operating system and CPU, extract it, and put `a2acli` (or `a2acli.exe`) on `PATH`.

Verify the installation:

```bash
a2acli --version
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

## 3. Give a2acli the endpoint and token

```bash
export A2A_BASE_URL=http://127.0.0.1:4000/a2a/google-adk
export A2A_BEARER_TOKEN="$(
  curl -fsS -u "$OAUTH_CLIENT_ID:$OAUTH_CLIENT_SECRET" \
    -d grant_type=client_credentials \
    -d 'scope=a2a.discover a2a.invoke' \
    http://127.0.0.1:9001/token | jq -r .access_token
)"
```

Try the CLI directly:

```bash
a2acli --base-url "$A2A_BASE_URL" card

a2acli --base-url "$A2A_BASE_URL" --compact \
  send --return-immediately -- 'Remember the codeword ORCHID.'
```

Copy the `task.id` and check it until the task completes:

```bash
export TASK_ID='<paste task ID>'
a2acli --base-url "$A2A_BASE_URL" --compact get-task "$TASK_ID"
```

Copy the task's `contextId` to continue the same conversation:

```bash
export CONTEXT_ID='<paste context ID>'
a2acli --base-url "$A2A_BASE_URL" --compact \
  send --return-immediately --context-id "$CONTEXT_ID" -- \
  'What codeword did I ask you to remember?'
```

## 4. Give the skill to an agent

The complete skill is [`skills/using-a2a-cli/SKILL.md`](../../skills/using-a2a-cli/SKILL.md). For Letta Code, start it from the repository root with this skill directory:

```bash
letta --skills "$PWD/skills"
```

For another shell-capable harness, copy `skills/using-a2a-cli` into its Agent Skills directory.

Ask the agent something like:

> Use the A2A CLI to ask the remote agent what codeword I told it to remember.

The skill tells the agent how to discover the remote Agent Card, send messages, poll tasks, continue a context, and cancel a task. There is no repository-owned launcher or workflow wrapper.

## Cleanup

```bash
unset A2A_BEARER_TOKEN A2A_BASE_URL
docker compose --profile example-12 down
rm -f .openai-api-key
```
