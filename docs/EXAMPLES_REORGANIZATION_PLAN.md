# Examples Reorganization Plan and Record

## Goal

Turn the repository's existing demonstrations into a progressive `examples/` learning path without duplicating the shared Docker stack, services, clients, or tests.

## Target structure

```text
examples/
├── README.md
├── 01-agent-discovery/
│   └── README.md
├── 02-basic-messaging/
│   └── README.md
├── 03-context-continuation/
│   └── README.md
├── 04-letta-to-external-a2a-agent/
│   └── README.md
└── 10-failure-and-cancellation/
    └── README.md
```

Only scenarios already supported by the implementation are created. Planned examples 05–09 and 11 remain in the index without empty directories.

## Content mapping

- Move the discovery and direct-client commands from the root README into examples 01 and 02.
- Turn the existing deterministic `remember` / `context` behavior into example 03.
- Replace the Letta-to-Letta `docs/SIMPLE-DEMO.md` with the more relevant Letta-to-external-agent example 04.
- Explain the deterministic failure and nested cancellation checks in example 10.
- Keep `docs/CONCLUSIONS.md` as the architectural result and stopping-point record.
- Keep shared implementation in `compose.yaml`, `services/`, `scripts/`, and `tests/`.

## Execution checklist

- [x] Create the five ready example READMEs using one consistent format.
- [x] Add links for implemented examples to `examples/README.md`.
- [x] Simplify the root README so it provides setup, architecture, verification, and links rather than duplicating walkthroughs.
- [x] Remove `docs/SIMPLE-DEMO.md` after its useful material is represented in the examples.
- [x] Verify all relative links and shell commands.
- [x] Run formatting, type, unit, Python, Compose, deterministic protocol, and live integration checks.

## Non-goals

- No protocol behavior changes.
- No gateway replacement during the documentation move.
- No duplicated Compose files or copied service implementations.
- No empty folders for planned examples.
- No three-agent scenario, physical-host deployment, binary file transfer, URL-handoff example, or dynamic registry.

## Completion criteria

The root README points readers into a numbered learning path; each implemented example can be followed independently against the shared stack; the roadmap clearly distinguishes built examples from future work; and the existing test matrix still passes unchanged.

## Validation record

Point-in-time validation completed on 2026-09-03:

- All local Markdown links resolve and `git diff --check` passes.
- The documented discovery, basic messaging, context continuation, Letta delegation, and deterministic failure commands were executed successfully against the shared lab.
- 22 Bun tests and 13 Python tests pass.
- TypeScript check/build and Compose validation pass.
- The provider-free protocol matrix and provider-backed live delegation/cancellation suite pass.
