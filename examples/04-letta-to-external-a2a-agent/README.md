# 04 — Letta to an External A2A Agent

## What this teaches

A Letta agent can decide to delegate work to an independently implemented A2A agent. The remote agent does not need access to Letta's memory, tools, model, or internal runtime.

The external fixture in this repository is written in Python, but that language choice is not part of the example's contract.

## Message flow

```text
client
  └──▶ agentgateway
        └──▶ Letta bridge ──▶ Agent A
                               └── a2a_invoke
                                    └──▶ agentgateway
                                          └──▶ external A2A agent
                                    ◀── completed artifact
        ◀──────────────────── Letta's final response
```

## Run it

Start the shared lab:

```bash
docker compose up --build -d
```

Ask Letta to delegate:

```bash
node scripts/smoke-a2a.mjs agent-a \
  "Use a2a_invoke with target reference-agent and message 'echo LETTA_EXTERNAL_OK'. Then return only the external agent's answer."
```

## Expected result

The outer Letta task completes with:

```text
LETTA_EXTERNAL_OK
```

There are two A2A tasks: the outer task addressed to Letta and the child task addressed to the external agent. The smoke client's final JSON contains the outer task; observe the child through the bridge logs or integration instrumentation.

## Watch it happen

```bash
docker compose logs -f --since=0s \
  agentgateway bridge agent-a reference-agent
```

The important bridge lines are:

```text
[agent-a] app-server event external_tool_call_request
[agent-a] invoking reference-agent through http://agentgateway:4000
[agent-a] received A2A result from reference-agent
```

## What the controller is doing

The bridge registers a scoped `a2a_invoke` external tool when it starts the Letta runtime. When Letta selects that tool, the bridge resolves the configured target, sends an asynchronous A2A message, polls the child task, and returns its artifact as the tool result. Letta then produces the outer response.

The delegation tool is exposed only for requests that explicitly ask for `a2a_invoke`, and nested metadata limits delegation to one hop.

## Boundaries

- Tool selection and the final Letta response are model-backed and not deterministic.
- The external `echo` behavior is deterministic.
- The target registry is static and only configured agents may be called.
- The next interoperability feature is the reverse direction: an external A2A agent initiating a task against Letta.
