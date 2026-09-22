# Example 13 — canonical A2A CLI update

Provider-free verification performed on 2026-09-22 against the existing Example 12 Google ADK route and authenticated agentgateway.

## Inputs

- Canonical CLI: [`a2aproject/a2a-cli`](https://github.com/a2aproject/a2a-cli) v0.2.0, Darwin arm64 release archive.
- The archive matched its published SHA-256 checksum.
- CLI version output identified `a2a 0.2.0`, commit `cacb1e2c3155555bbdb50717c58052f9c19c7b2f`.
- Target: provider-free Google ADK fake model through `http://127.0.0.1:4000/a2a/google-adk`.
- Authentication: a short-lived operator JWT from the local OAuth fixture. No token or credential value was recorded.

## Executed behavior

Using direct endpoint mode with `--transport jsonrpc` and the authenticated gateway:

1. `send --async -o json` returned a submitted task with task and context IDs.
2. `task get --wait -o json` reached `TASK_STATE_COMPLETED` and returned the text artifact `STORED: ORCHID`.
3. A second blocking `send --context-id ...` preserved the exact context ID and returned `ORCHID`.
4. `task list -o json` returned both completed tasks in that context.

This proves the canonical CLI's asynchronous send, polling, blocking send, task listing, authenticated JSON-RPC transport, and context continuation against the lab. The target advertises no streaming, and its deterministic tasks settle too quickly for a meaningful cancellation proof; those commands remain part of the upstream official skill rather than claims of this fixture.

## Agent Card incompatibility discovered

The gateway-published card is valid strict A2A 1.0 ProtoJSON and contains:

```json
{"securityRequirements":[{"schemes":{"a2aOAuth":{"list":["a2a.invoke"]}}}]}
```

`a2a card get` in v0.2.0 rejected the card with `A2ACLI_ERR_CARD_INVALID` because the Go decoder attempted to unmarshal the `StringList` object into a bare `[]string`. The A2A specification, official Python and JavaScript SDKs, and this repository's existing tests use the `{ "list": [...] }` shape. The card was not weakened or rewritten to accommodate the client. Example 13 uses the CLI's supported direct-endpoint mode and records the limitation explicitly.

An additional `send --stream -o jsonl` probe reached the target, received the target's expected `UNSUPPORTED_OPERATION`, then exited successfully without output instead of visibly polling. That behavior is not presented as verified streaming fallback in the walkthrough.

## Documentation and skill

- Example 13 now teaches the canonical `a2a` binary and standardized `card`, `send`, and `task` taxonomy.
- The old Rust `a2acli` v0.1.11 commands were removed.
- `skills/a2a-cli/SKILL.md` is the official descriptor shipped in canonical CLI v0.2.0 (`metadata.version: 2026.09.08`), retained locally with its Apache 2.0 license for a reproducible example.
- Root, examples, conclusions, and package-plan references now name the canonical CLI.

No package implementation, Agent Card, gateway policy, or service code changed in this update.
