# Changelog

## 0.1.0-alpha.1 — Unreleased

Initial prerelease candidate extracted from the educational Letta A2A lab.

- Official A2A 1.0 handler/executor composition with scoped task access, streaming, interruption, and application-owned transport/authentication.
- Existing-agent Agent SDK runner, explicit tool governance, serialized conversations, and bounded shutdown with unresolved outcomes preserved.
- Optional single-owner native SQLite recovery for tasks, mappings, deduplication, execution fences, and SDK snapshot repair.
- SDK interruption is not backend-stop proof; uncertain execution requires privileged evidence-backed reconciliation, never automatic replay.
- MIT licensing, pinned build/support baseline, and clean consumer release checks.

Not published. Text-only execution, shared agent memory, volatile push registration, and the documented local-filesystem/backend limitations remain intentional.
