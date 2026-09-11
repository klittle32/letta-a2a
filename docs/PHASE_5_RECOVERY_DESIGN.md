# Phase 5 recovery ordering

The initial profile is one local controller per binding directory. SQLite stores official SDK Task snapshots and a small execution journal; a separate SQLite exclusive transaction holds the process-lifetime ownership lock. OS process death releases that lock, not a wall-clock lease. Filesystem aliases resolve to one canonical directory. All cooperating controllers must use that directory; network filesystems, multiple directories for one binding, and distributed ownership are unsupported.

The official handler and ResultManager remain responsible for protocol task reduction/query behavior. Execution records are operational fences, not new wire task states.

| Boundary | Durable fact before proceeding | Recovery |
|---|---|---|
| Validated message | Owner/tenant/message deduplication tombstone | Duplicate never resubmits |
| Executor acceptance | Official initial Task and attempt/context correlation atomically committed | Accepted but undispatched is provably unsent |
| Dispatch into runner | Dispatch intent | Unknown until instrumented SDK pre-send stages establish more |
| SDK ready | Owner-scoped unique conversation mapping | No fallback to legacy/unowned mapping |
| Before SDK send | Agent/conversation/OTID and submission intent | Intent is ambiguous even if the process died just before sending |
| Send returns | Transport observation only | Not a durable acceptance receipt |
| SDK observations | Public assistant output and limited correlation/result fields | No reasoning/tool payloads; no missed-event replay claim |
| Normal success after cleanup | Stopped evidence | Recover local publication without another model turn |
| Final publication | Official SDK-reduced terminal snapshot committed as publication intent | Idempotent snapshot repair, never replay append deltas |
| SDK saves terminal snapshot | Publication acknowledged | Release execution fence only when stop is established |
| Cancellation | Intent before abort | Abort acknowledgment or SDK interruption is not stop proof |

The pinned Code 0.30.25 path emits interruption while backend cancellation is still in progress and may fail. Consequently the SDK runner must quarantine a sent interrupted turn, rather than claiming confirmed cancellation. A trusted custom runner can still explicitly certify a stopped cancellation. Missing completion, failed disposal, uncertain sends, and disconnected turns stay fenced across restarts—even when the A2A request is marked failed.

Recovery never automatically sends input. It repairs already-proven stopped outcomes and reports unresolved attempts for exact-identity operator/readback reconciliation. Operator resolution requires evidence tied to the attempt and conversation; it is not a model-callable permission or a bare clear-quarantine switch. Restarted subscriptions follow SDK snapshot/terminal behavior, not historical event replay.

Retention prunes only stopped terminal tasks, keeps deduplication tombstones, and never removes unresolved work or referenced conversation mappings. Shutdown releases the process owner only after executor and official task persistence have drained. An incomplete shutdown retains the owner. Push registrations remain advisory and require re-registration in the initial durable profile; no exactly-once callback delivery is claimed.
