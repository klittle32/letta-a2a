# letta-a2a-client

## Purpose

Two host-governed tools backed by the shared official-SDK client library:

- `a2a_invoke`: invoke or continue a configured peer, retaining task/context identity.
- `a2a_task`: inspect or request cancellation of a known task.

## Behavior

Polls asynchronous sends until terminal or input/auth interruption. Reuses durable remote contexts by host-derived local conversation and endpoint. Same-task followup uses `task_id`. Compact JSON keeps status text separate from partial artifacts and explicitly summarizes/marks omitted nontext content.

## Entry point

`dist/a2a-client.mjs`, bundled from `mods/a2a-client.ts`. Importable Node and optional Agent SDK adapters are separate exports, documented in the [README](README.md).

## Safety

Both tools require host approval; remote agents retain responsibility for their own consequential actions. Model arguments cannot choose arbitrary URLs or caller identity. Named HTTP(S) routes reject embedded credentials, and discovered/actual endpoints stay on that origin with redirects disabled. This is a trusted-route policy, not general SSRF or tenant isolation.

State holds correlation metadata, not credentials or message payloads. Cooperating file-store users lock actual remote contexts across processes; unknown submissions remain unresolved rather than being blindly retried. Orphan locks require manual verification and recovery, not time-based stealing. Cancellation remains unconfirmed unless authoritative readback says otherwise.

Mods are trusted local code. Review the package and configure only trusted peers. Unloading unregisters both tools and requests cancellation of active work; it does not claim remote execution stopped.
