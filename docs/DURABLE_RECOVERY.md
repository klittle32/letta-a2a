# Local durable recovery profile

Phase 5 adds **single-owner, fail-closed recovery**, not automatic in-flight resumption. The tested implementation uses native `node:sqlite` on Node 24.19.0 (macOS and Linux containers), plus Bun 1.4.2 development tests. Other runtime/OS/backend combinations remain release-validation work.

## Enable in the lab

Set `BRIDGE_DURABLE_DIRECTORY=/data/durable` in the lab environment. Compose already persists `/data` in `bridge-state`. Leaving the setting blank preserves the historical volatile task profile. Each definition gets its own directory; its binding identity is `JSON.stringify([definition.key, definition.appServerUrl, definition.displayName])`. The resolved agent ID and sharing domain are also pinned. Changing them does not silently migrate stored conversations.

Existing `contexts.json` entries are **not imported**. Enabling the profile is an explicit new state boundary, not proof that old in-flight work stopped. Reconcile old work before changing profiles.

## Library composition

```ts
import {
  DurableBinding, createBridge, createAgentToolGuard, createToolPolicy,
} from "letta-a2a-bridge";

// client and agentId belong to an explicitly configured, existing agent.
const durability = await DurableBinding.open({
  directory: "/private/app-state/agent-a",
  bindingId: "agent-a@configured-backend",
});
const guard = createAgentToolGuard(client, agentId);
const bridge = createBridge({
  durability,
  client,
  agentId,
  sharingDomain: "agent-a",
  publicBaseUrl: "http://127.0.0.1:8080",
  sessionOptions: createToolPolicy(),
  beforeTurn: (request) => guard(request.signal),
});
// Mount/listen using the usual bridge transport. Authentication is still required
// for untrusted callers; the anonymous profile is one shared loopback trust domain.
const result = await bridge.close();
if (!result.complete) {
  // Ownership is retained. Do not erase lock files or assume remote execution stopped.
}
```

`createBridge({ client, ... })` wires durable mapping and awaited execution hooks automatically. A custom runner must honor the existing `LettaTurnRunner` settlement/serialization contract. The service's custom runtime explicitly wires these hooks into its `AgentSdkTurnRunner`. Custom dispatch that crashes before providing correlation is conservatively unresolved.

One bridge may attach to an opened binding. All cooperating controllers for that binding must use the **same canonical directory**. A lifetime SQLite exclusive transaction in `owner.sqlite` rejects another owner; the separate state database commits normally using WAL and FULL synchronization. OS process death releases the lock. There is no timestamp-based lock stealing. Network filesystems, copying/hard-linking state into independently owned directories, hostile local filesystem writers, and distributed ownership are unsupported.

## What survives

- Official SDK task snapshots, history, artifacts, owner/tenant queries, and authorized conversation mappings.
- Message deduplication tombstones, even after terminal-task pruning.
- Accepted attempts, submission intent, known conversation/agent/OTID, observed run IDs, cancellation intent, and unresolved fences.
- Stopped publication intent: recovery repairs an SDK-reduced snapshot without replaying append events or sending input again.
- Settled custom input/auth interruptions can continue after restart. Terminal subscriptions still reject; an interrupted task without an active bus yields the SDK snapshot and ends. Missed SDK stream events are not replayed.

Push configuration/delivery remains advisory and process-local: re-register after restart. The Python reference agent's own in-memory state is unchanged. Existing client journals retain their separately documented contract; this profile is not a new guarantee of automatic client-side recovery.

## Cancellation is not confirmation

The pinned Code 0.30.25 path can report interruption before backend cancellation finishes, and SDK disconnect can synthesize a failed result. `abort()` returning, `interrupted`, disposal, idle projections, and a history entry are **not sufficient stop evidence**.

The SDK runner therefore quarantines sent interrupted/failed/uncertain turns. The A2A request may be `FAILED` with a reconciliation message while remote work is still unknown. That failure does not release the conversation fence. `CancelTask` refuses to invent a canceled outcome; its persisted intent survives restart. A trusted custom runner may certify stopped cancellation, and an already-settled interruption can be canceled safely.

## Operator procedure

1. Stop the controller owning this binding. If graceful close reports incomplete, retain that fact; process termination releases only the local lock, not remote-work ownership evidence. Do not delete SQLite/lock files to bypass an active owner.
2. Open `DurableBinding` with the exact existing directory and binding ID, **without attaching a bridge**, and call `inspectRecovery()`. Record the exact attempt ID, agent/conversation/OTID, observed run IDs, and cancellation intent. Keep state/history private.
3. Inspect the configured backend. The verified public SDK readback is:

   ```ts
   const page = await client.conversations.listMessages(record.conversationId, {
     order: "asc", limit: 100,
   });
   ```

   It does not create a session or send user input. History presence proves persisted messages, not whole-turn settlement; absence does not prove non-submission. Agent SDK 0.8.3 has no verified durable receipt plus whole-turn settlement query for this App Server deployment. Use separately verified backend/operator evidence to establish the outcome. If requesting abort manually, first persist `requestCancellation(record.taskId, scopedServerCallContext)`, then resume the exact conversation, await readiness, and request abort. The acknowledgment alone still leaves the attempt unresolved.
4. Only after verifying stop, call the privileged host API:

   ```ts
   await durability.resolveWithVerifiedStop({
     attemptId: record.id,
     conversationId: record.conversationId,
     evidence: "Specific independent backend/operation evidence establishing stop and outcome",
     outcome: "failed", // or completed/canceled only when that outcome is established
   });
   ```

   This is an operator attestation, not an automated proof or a model-callable approval. Unknown output should remain failed, not be invented. If the dispatch crashed **before conversation correlation existed**, the alternative requires `bindingStopped: { bindingId, evidence }`: independently establish that **all possible runtime/tool work for this binding** stopped. A bare context ID or empty evidence cannot clear the fence. Without adequate evidence, leave it unresolved.
5. Close the detached state owner and restart the controller. Live SDK-local quarantine is intentionally not cleared in place. New work may proceed only after the durable fence is resolved.

## Retention and shutdown

`prune(beforeEpochMilliseconds)` removes only stopped terminal tasks and their attempt/publication records older than the cutoff. It cannot prune unresolved or interrupted work. Mappings and message tombstones remain, so old input cannot become executable again merely because history was removed.

Admission defaults: 10,000 tasks, 100,000 journal/mapping entries, and an 8 MiB input/observation record budget. `maxTasks`, `maxJournalEntries`, and `maxRecordBytes` are configurable at open. Admission also checks actual SDK representation expansion; tiny chunks cannot evade the limit. Derived snapshots have reserved capacity, and recovery preserves already-admitted data rather than rejecting it because current admission limits changed. Limits reject new work; they do not truncate history or forget tombstones. When a tombstone limit is reached, archive only after reconciliation and deliberately create a **new sharing/binding identity**—do not erase deduplication state under the old identity. SQLite may retain freed pages; offline backup/compaction is an operator storage task.

Close stops admission, drains queued facade requests and SDK execution/publication, then performs a fresh final drain before releasing the owner. Incomplete shutdown reports pending/uncertain work and retains ownership. Durable data requires normal private backups; corruption, incompatible identity/schema, or disk failure fails closed. Crash consistency is not a substitute for backups, sufficient disk capacity, or backend reconciliation.
