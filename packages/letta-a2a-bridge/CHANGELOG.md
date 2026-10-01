# Changelog

## 0.1.0-alpha.1 — Unreleased

Initial prerelease candidate extracted from the educational Letta A2A lab.

- Official A2A 1.0 handler/executor composition with scoped task access, streaming, interruption, and application-owned transport/authentication.
- Existing-agent Agent SDK runner, explicit tool governance, serialized conversations, and bounded shutdown with unresolved outcomes preserved.
- Optional single-owner native SQLite recovery for tasks, mappings, deduplication, execution fences, and SDK snapshot repair.
- SDK interruption is not backend-stop proof; uncertain execution requires privileged evidence-backed reconciliation, never automatic replay.
- MIT licensing, pinned build/support baseline, and clean consumer release checks.
- Letta Agent SDK 0.8.27 (Letta Code 0.34.1). `overrides` pin both, because Letta's packages pin each other in a chain (Code 0.34.1 → SDK 0.8.24 → Code 0.33.7 → …) that Bun's resolver cannot finish.
- Fixed: anonymous discovery served the SDK's internal card object, leaking oneof wrappers (`securitySchemes.*.scheme.$case`) that A2A clients reject. It now serves the ProtoJSON wire form.
- Fixed: stored artifacts held one text part per streamed token, so `GetTask` and blocking `SendMessage` returned fragments. Read paths (`GetTask`, `ListTasks`, blocking `SendMessage`, `CancelTask`, the resubscribe snapshot) now join adjacent text parts; the live stream stays append-only and concatenates to the full answer.
- Streaming deltas are batched: text is sent every 100 ms or 200 characters, whichever comes first, instead of one event (and one task-store save) per token. The newest piece is still held back so the final delta carries `lastChunk`.

Not published. Text-only execution, shared agent memory, volatile push registration, and the documented local-filesystem/backend limitations remain intentional.
