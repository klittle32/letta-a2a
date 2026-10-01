# Run a Letta agent on exe.dev behind agentgateway

## What this teaches

Deploy a local-backend Letta agent to its own [exe.dev](https://exe.dev) VM, expose it over A2A with [`letta-a2a-bridge`](../../packages/letta-a2a-bridge/), and reach it from a laptop through agentgateway on a second VM. No Docker, OAuth fixture, or model API key is involved:

- **Model access** comes from exe.dev's LLM integration (`https://llm.int.exe.xyz`). Here it serves GPT-6 Luna from a ChatGPT subscription, so no provider key lives on the VM.
- **Gateway → agent** uses an exe.dev VM-to-VM integration. exe.dev injects the credential at its edge and stamps `X-Exedev-Source-Vm`, which the agent checks.
- **Client → gateway** uses an agentgateway `apiKey` policy, advertised in the agent card.

The agent is **Scooter**: a tool-free, fast, low-cost worker for classifying, extracting, drafting, and normalizing text. Letta's memory keeps a caller's label sets and style rules across a conversation.

## Message flow

```text
a2a CLI (laptop)
  → exe.dev edge (VM token) → agentgateway on the gateway VM (X-API-Key, a2a policy)
  → exe.dev VM-to-VM integration (injected credential, X-Exedev-Source-Vm)
  → Express + createBridgeRouter on the agent VM (source-VM guard)
  → LettaAgentExecutor → Letta Agent SDK 0.8.27 → local Letta Code 0.34.1 App Server
  → llm.int.exe.xyz (ChatGPT subscription) → GPT-6 Luna, reasoning high
```

| File | Responsibility |
| --- | --- |
| [`server.ts`](src/server.ts) | Wire the Letta client, bridge, card, and a non-loopback Express listener. |
| [`card.ts`](src/card.ts) | Scooter's description, skills, and the gateway API key scheme. |
| [`source-vm-guard.ts`](src/source-vm-guard.ts) | Allow A2A calls only from the gateway VM; keep discovery open. |
| [`letta-agent.ts`](src/letta-agent.ts) | Create or reuse the agent with its persona. |
| [`config.ts`](src/config.ts) | Read and validate environment configuration. |
| [`deploy/`](deploy/) | systemd unit and the agentgateway routes. |

## Run it

On the agent VM (Node 24, Bun 1.4.2):

```bash
git clone https://github.com/klittle32/letta-a2a && cd letta-a2a
(cd packages/letta-a2a-bridge && bun install --frozen-lockfile --ignore-scripts && bun run build)
cd examples/15-letta-agent-on-exe-dev
bun install --frozen-lockfile --ignore-scripts
bun run check && bun test tests
```

Point Letta Code's OpenAI provider at exe.dev once. The key is a placeholder; exe.dev injects the real credential:

```bash
node node_modules/@letta-ai/letta-code/letta.js connect openai --backend local \
  --api-key exe-dev --base-url https://llm.int.exe.xyz/v1
node node_modules/@letta-ai/letta-code/letta.js model list --backend local | grep gpt-6-luna
```

Install [`deploy/scooter.service`](deploy/scooter.service), adjusting the user and paths, then `sudo systemctl enable --now scooter`. The first start creates the agent. To make high reasoning the agent's default as well as each session's:

```bash
node node_modules/@letta-ai/letta-code/letta.js model set openai/gpt-6-luna \
  --reasoning high --backend local --agent <agent-id>
```

From your workstation, link the gateway VM to the agent VM and add [the routes](deploy/agentgateway-routes.yaml) to the gateway config:

```bash
ssh exe.dev integrations add http-proxy --name scooter \
  --target https://<agent-vm>.exe.xyz/ --peer --attach vm:<gateway-vm>
```

Then call it with the [official `a2a` CLI](../13-a2a-cli-skill/). While the gateway VM is private, pass an exe.dev VM token (`ssh exe.dev ssh-key generate-api-key --vm=<gateway-vm>`) as `--auth "Bearer ..."`:

```bash
S=https://<gateway-vm>.exe.xyz/scooter/.well-known/agent-card.json
a2a card get -a $S --auth "Bearer $EXE_TOKEN"
a2a send -a $S --auth "Bearer $EXE_TOKEN" --svc-param "X-API-Key=$KEY" \
  "For this conversation my labels are billing, outage, onboarding. Reply ok."
a2a send -a $S --auth "Bearer $EXE_TOKEN" --svc-param "X-API-Key=$KEY" \
  --context-id <context-id> "Label: I was charged twice; the site is down in EU"
```

## Expected result

The card lists four skills and an `X-API-Key` scheme, and its interface URL points at the gateway:

```text
Name:         Scooter
Interfaces:
  JSONRPC      https://<gateway-vm>.exe.xyz/scooter/
Skills:
  classify             Classify and tag
  extract              Extract structured data
  generate             Draft short text at volume
  normalize            Clean up and normalize
```

A send without the key fails with `401 Unauthorized` from agentgateway; a call that skips the gateway gets `403` from the guard. The first send prints a `Context:` ID. The follow-up with that ID applies the remembered labels:

```text
Status:   completed
  [Letta response] (a) billing
(b) outage
```

## Watch it happen

Keep the Scooter log open on the agent VM. Rejected callers are logged by the guard; the startup line names the agent ID, model, and reasoning tier:

```bash
sudo journalctl -u scooter -f | grep -E 'Scooter|rejected|error'
```

On the gateway VM, follow the same call through agentgateway. The `a2a.context.id` matches the `Context:` printed by the CLI on every turn:

```bash
sudo journalctl -u agentgateway -f | grep 'route=default/scooter' \
  | grep -oE 'a2a\.(method|task\.state|context\.id)=[^ ]*'
```

## What the controller is doing

[`server.ts`](src/server.ts) composes Example 14's pieces for a remote host:

1. Creates or reuses the Letta agent with the `openai/gpt-6-luna` handle and a tool-free, strict-permission persona.
2. Calls `createBridge` with the gateway's API key scheme, then replaces the card's description and skills.
3. Returns session options per turn: `createToolPolicy()` (deny every tool), plus `model` and `reasoningEffort: "high"`.
4. Mounts `createBridgeRouter` behind the source-VM guard on an Express listener bound to all interfaces, because `listenLoopback` only binds 127.0.0.1.

`LettaAgentExecutor` streams assistant text as artifact deltas, then ends each turn with one consolidated part, so `GetTask` returns the whole answer as a single text part.

## Boundaries

- Anonymous bridge profile: one sharing domain, so every caller who passes the gateway shares Scooter's conversations. Use the authenticated profile for per-caller isolation.
- A2A tasks and the context-to-conversation map are in memory and lost on restart; the Letta agent and its conversations persist under `~/.letta`.
- No tools. The persona declines requests needing live data or long reasoning.
- **ChatGPT-subscription models on exe.dev speak only the OpenAI Responses API**, with `store: false` and list input. Letta Code's `openai` provider handles that; Chat Completions requests are rejected.
- **Letta Code knows `gpt-6-luna` from 0.34.x**, which needs Letta Agent SDK 0.8.27. `createAgent` wants the handle `openai/gpt-6-luna`; catalog ids such as `gpt-6-luna-high` throw `Unknown model`.
- **Letta's packages pin each other in a chain** (Code 0.34.1 → SDK 0.8.24 → Code 0.33.7 → …). Bun's resolver spins on it and npm installs nested copies. The `overrides` in `package.json` collapse it to one version of each.
- **`securityRequirements` stays empty.** The spec-correct form breaks the `a2a` CLI 0.3.0 card parser; agentgateway enforces the key either way.
- This example deploys across two hosts, which the [examples roadmap](../README.md#deliberate-non-goals) otherwise lists as a non-goal.
- Evidence: exercised end to end on exe.dev VMs on 2026-10-01 with the commands above, including streaming, context continuation, and both rejection paths.
