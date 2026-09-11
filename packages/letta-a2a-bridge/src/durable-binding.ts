import { Message, Task, TaskState } from "@a2a-js/sdk";
import {
  AgentEvent,
  InMemoryTaskStore,
  ResultManager,
  ServerCallContext,
  resolveUserScope,
  type AgentExecutionEvent,
  type RequestContext,
  type TaskStore,
} from "@a2a-js/sdk/server";
import { UnsupportedOperationError } from "@a2a-js/sdk/errors";
import { SqliteBindingStore } from "./sqlite-store.js";
import { agentMessage, textPart } from "./a2a-text.js";
import type {
  LettaTurnRequest,
  SessionExecutionLifecycle,
  SessionPolicy,
} from "./letta-agent.js";

type ExecutionRequest = Pick<
  RequestContext,
  "taskId" | "contextId" | "userMessage" | "context"
>;
type Phase =
  | "accepted"
  | "dispatching"
  | "preparing"
  | "intent"
  | "stopped"
  | "publishing"
  | "done"
  | "unresolved";
export interface RecoveryRecord {
  id: string;
  owner: string;
  tenant: string;
  taskId: string;
  messageId: string;
  contextId: string;
  contextKey: string;
  artifactId: string;
  phase: Phase;
  createdAt: number;
  updatedAt: number;
  agentId?: string;
  conversationId?: string;
  otid?: string;
  sendReturned?: boolean;
  cancelRequested?: boolean;
  stopped?: boolean;
  publicChunks: string[];
  runIds: string[];
  resultText?: string;
  publication?: true;
  evidence?: string;
}
const finalStates = new Set([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
]);
function scope(c: ServerCallContext) {
  return { owner: resolveUserScope(c), tenant: c.tenant ?? "" };
}
function recordKey(owner: string, tenant: string, messageId: string) {
  return JSON.stringify([owner, tenant, messageId]);
}
function recordContext(r: RecoveryRecord) {
  return new ServerCallContext({
    user: { isAuthenticated: true, userName: r.owner },
    tenant: r.tenant,
  });
}
export function executionContextKey(r: ExecutionRequest): string {
  return JSON.stringify([
    resolveUserScope(r.context),
    r.context.tenant ?? "",
    r.contextId,
  ]);
}

/** Durable single-owner profile. Recovery is inspection/repair, never automatic input replay. */
export class DurableBinding {
  private attached = false;
  private readonly acknowledgments = new Map<string, () => void>();
  readonly taskStore: TaskStore;
  readonly conversationMapping: NonNullable<
    SessionPolicy["conversationMapping"]
  >;
  readonly execution: SessionExecutionLifecycle;

  private constructor(
    private readonly storage: SqliteBindingStore,
    private readonly maxTasks: number,
    private readonly maxJournalEntries: number,
    private readonly maxRecordBytes: number,
    private readonly bindingId: string,
  ) {
    this.taskStore = {
      load: (id, c) => storage.load(id, c),
      list: (p, c) => storage.list(p, c),
      save: async (task, c) => {
        this.assertSize(Task.toJSON(task), 3);
        const records = this.attempts().filter(
          (r) =>
            r.taskId === task.id &&
            r.owner === resolveUserScope(c) &&
            r.tenant === (c.tenant ?? "") &&
            r.phase === "publishing",
        );
        storage.transaction(() => {
          storage.saveTask(task, c);
          for (const record of records) {
            const expected =
              this.savedPublication(record).status?.message?.messageId;
            if (expected && expected === task.status?.message?.messageId) {
              record.phase = record.stopped ? "done" : "unresolved";
              this.put(record);
            }
          }
        });
        for (const record of records)
          if (record.phase !== "publishing") {
            this.acknowledgments.get(record.id)?.();
            this.acknowledgments.delete(record.id);
          }
      },
    };
    this.conversationMapping = {
      get: async (key) => storage.getRecord<string>("mappings", key),
      set: async (key, value) => {
        this.assertSize([key, value]);
        const existing = storage.getRecord<string>("mappings", key);
        if (
          !existing &&
          storage.records("mappings").length >= maxJournalEntries
        )
          throw new Error("Conversation mapping limit reached");
        if (existing && existing !== value)
          throw new Error("Conversation mapping cannot change");
        if (
          storage
            .records<string>("mappings")
            .some(([other, id]) => other !== key && id === value)
        )
          throw new Error("Conversation is already owned by another context");
        storage.setRecord("mappings", key, value);
      },
    };
    this.execution = {
      beforeTurn: async (request) => {
        this.assertAvailable(request.a2aContextId, request.messageId);
        this.updateTurn(request, (r) => {
          r.phase = "preparing";
        });
      },
      beforeSend: async (request, correlation) => {
        this.assertAvailable(request.a2aContextId, request.messageId);
        const oldAgent = storage.getRecord<string>("meta", "agentId");
        if (oldAgent && oldAgent !== correlation.agentId)
          throw new Error("Durable agent identity mismatch");
        await this.conversationMapping.set(
          request.a2aContextId,
          correlation.conversationId,
        );
        storage.transaction(() => {
          storage.setRecord("meta", "agentId", correlation.agentId);
          this.updateTurn(request, (r) => {
            Object.assign(r, correlation);
            r.phase = "intent";
          });
        });
      },
      sent: async (request) => {
        this.updateTurn(request, (r) => {
          r.sendReturned = true;
        });
      },
      observe: async (request, message) => {
        const r = this.turnRecord(request);
        if (message.type === "assistant") r.publicChunks.push(message.content);
        if (message.type === "loop_status") {
          for (const id of message.activeRunIds)
            if (!r.runIds.includes(id)) r.runIds.push(id);
        }
        if (message.type === "result") {
          for (const id of message.runIds ?? [])
            if (!r.runIds.includes(id)) r.runIds.push(id);
          if (message.success) r.resultText = message.result;
        }
        // Account for SDK artifact-part expansion, not just raw chunk strings.
        const preview = await this.reduce(
          r,
          this.recoveryEvents(
            r,
            TaskState.TASK_STATE_FAILED,
            "Execution status is unknown; operator reconciliation is required",
          ),
        );
        this.assertSize(Task.toJSON(preview), 3);
        this.put(r);
      },
      stopped: async (request) => {
        this.updateTurn(request, (r) => {
          r.phase = "stopped";
          r.stopped = true;
        });
      },
      unresolved: async (request) => {
        this.updateTurn(request, (r) => {
          r.phase = "unresolved";
          r.stopped = false;
        });
      },
    };
  }

  static async open(options: {
    directory: string;
    bindingId: string;
    maxTasks?: number;
    maxJournalEntries?: number;
    maxRecordBytes?: number;
  }): Promise<DurableBinding> {
    const maxTasks = options.maxTasks ?? 10_000;
    const maxJournalEntries = options.maxJournalEntries ?? 100_000,
      maxRecordBytes = options.maxRecordBytes ?? 8 * 1024 * 1024;
    if (!Number.isSafeInteger(maxTasks) || maxTasks < 1)
      throw new Error("Invalid durable task retention bound");
    if (
      !Number.isSafeInteger(maxJournalEntries) ||
      maxJournalEntries < 1 ||
      !Number.isSafeInteger(maxRecordBytes) ||
      maxRecordBytes < 1024
    )
      throw new Error("Invalid durable journal bound");
    const storage = await SqliteBindingStore.open(options);
    try {
      const binding = new DurableBinding(
        storage,
        maxTasks,
        maxJournalEntries,
        maxRecordBytes,
        options.bindingId,
      );
      binding.validate();
      await binding.recover();
      return binding;
    } catch (error) {
      storage.close();
      throw error;
    }
  }

  /** One bridge may attach. Incomplete shutdown must not release the owner. */
  attach(sharingDomain: string): (complete: boolean) => Promise<void> {
    if (this.attached)
      throw new Error("Durable binding already has a bridge owner");
    const old = this.storage.getRecord<string>("meta", "sharingDomain");
    if (old && old !== sharingDomain)
      throw new Error("Durable sharing domain mismatch");
    this.storage.setRecord("meta", "sharingDomain", sharingDomain);
    this.attached = true;
    return async (complete) => {
      if (complete) {
        this.attached = false;
        await this.close();
      }
    };
  }
  async close(): Promise<void> {
    if (this.attached)
      throw new Error("Bridge must drain before durable owner release");
    this.storage.close();
  }
  bindAgent(agentId: string): void {
    const old = this.storage.getRecord<string>("meta", "agentId");
    if (!agentId || (old && old !== agentId))
      throw new Error("Durable agent identity mismatch");
    this.storage.setRecord("meta", "agentId", agentId);
  }
  private attempts(): RecoveryRecord[] {
    return this.storage.records<RecoveryRecord>("executions").map(([, r]) => r);
  }
  private assertSize(value: unknown, multiplier = 1): void {
    if (
      Buffer.byteLength(JSON.stringify(value)) >
      this.maxRecordBytes * multiplier
    )
      throw new Error("Durable record size limit reached");
  }
  private put(r: RecoveryRecord, recovery = false): void {
    r.updatedAt = Date.now();
    // Reopen adds only mandatory bookkeeping to already-admitted data. Admission
    // limits must never strand the binding while recording that recovery result.
    if (!recovery) this.assertSize(r);
    this.storage.setRecord("executions", r.id, r);
  }
  private validate(): void {
    const records = this.storage.records<RecoveryRecord>("executions");
    const version = this.storage.getRecord<number>("meta", "recoveryVersion");
    if (
      (version === undefined && records.length) ||
      (version !== undefined && version !== 1)
    )
      throw new Error("Invalid recovery schema version");
    const phases: Phase[] = [
      "accepted",
      "dispatching",
      "preparing",
      "intent",
      "stopped",
      "publishing",
      "done",
      "unresolved",
    ];
    for (const [key, r] of records) {
      if (
        !r ||
        !phases.includes(r.phase) ||
        typeof r.owner !== "string" ||
        typeof r.tenant !== "string" ||
        !r.taskId ||
        !r.messageId ||
        !r.contextId ||
        !r.artifactId ||
        r.id !== key ||
        key !== recordKey(r.owner, r.tenant, r.messageId) ||
        r.contextKey !== JSON.stringify([r.owner, r.tenant, r.contextId]) ||
        !Array.isArray(r.publicChunks) ||
        !r.publicChunks.every((v) => typeof v === "string") ||
        !Array.isArray(r.runIds) ||
        !r.runIds.every((v) => typeof v === "string") ||
        !Number.isFinite(r.createdAt) ||
        !Number.isFinite(r.updatedAt) ||
        (["done", "stopped"].includes(r.phase) && r.stopped !== true)
      )
        throw new Error("Invalid recovery record");
      if (r.publication !== undefined && r.publication !== true)
        throw new Error("Invalid recovery publication marker");
      if (r.publication) {
        const task = this.savedPublication(r);
        if (task.id !== r.taskId || task.contextId !== r.contextId)
          throw new Error("Invalid recovery publication identity");
      }
    }
    this.storage.setRecord("meta", "recoveryVersion", 1);
  }
  private find(request: ExecutionRequest): RecoveryRecord {
    const { owner, tenant } = scope(request.context);
    const record = this.storage.getRecord<RecoveryRecord>(
      "executions",
      recordKey(owner, tenant, request.userMessage.messageId),
    );
    if (!record || record.taskId !== request.taskId)
      throw new Error("Missing durable acceptance");
    return record;
  }
  private updateTurn(
    request: LettaTurnRequest,
    update: (record: RecoveryRecord) => void,
  ): void {
    const record = this.turnRecord(request);
    update(record);
    this.put(record);
  }
  private turnRecord(request: LettaTurnRequest): RecoveryRecord {
    const record = this.attempts().find(
      (r) =>
        r.contextKey === request.a2aContextId &&
        r.messageId === request.messageId &&
        (!request.taskId || r.taskId === request.taskId),
    );
    if (!record) throw new Error("Missing durable turn correlation");
    return record;
  }
  assertAvailable(key: string, messageId?: string): void {
    if (
      this.attempts().some(
        (r) =>
          r.contextKey === key &&
          r.messageId !== messageId &&
          r.phase === "unresolved",
      )
    )
      throw new UnsupportedOperationError(
        "Context execution requires reconciliation",
      );
    if (
      this.attempts().some(
        (r) =>
          r.contextKey === key &&
          r.messageId === messageId &&
          r.phase === "unresolved",
      )
    )
      throw new UnsupportedOperationError(
        "Context execution requires reconciliation",
      );
  }
  async reserveMessage(message: Message, c: ServerCallContext): Promise<void> {
    const { owner, tenant } = scope(c),
      key = recordKey(owner, tenant, message.messageId);
    if (this.storage.getRecord("messages", key))
      throw new UnsupportedOperationError("Duplicate message submission");
    this.assertSize(key);
    if (this.storage.records("messages").length >= this.maxJournalEntries)
      throw new UnsupportedOperationError(
        "Durable journal limit reached; tombstones cannot be forgotten safely",
      );
    this.storage.setRecord("messages", key, { reservedAt: Date.now() });
  }
  async accept(
    request: ExecutionRequest,
    initial: Task,
    artifactId: string,
  ): Promise<void> {
    const { owner, tenant } = scope(request.context),
      id = recordKey(owner, tenant, request.userMessage.messageId);
    if (this.storage.getRecord("executions", id))
      throw new UnsupportedOperationError("Duplicate execution");
    if (
      !(await this.storage.load(initial.id, request.context)) &&
      this.storage.listAllTasks().length >= this.maxTasks
    )
      throw new UnsupportedOperationError(
        "Durable task limit reached; prune stopped tasks before accepting more",
      );
    const memory = new InMemoryTaskStore();
    const reducer = new ResultManager(memory, request.context);
    reducer.setContext(request.userMessage);
    await reducer.processEvent(AgentEvent.task(initial));
    const task = (await memory.load(initial.id, request.context))!;
    this.assertSize(Task.toJSON(task));
    const record: RecoveryRecord = {
      id,
      owner,
      tenant,
      taskId: request.taskId,
      messageId: request.userMessage.messageId,
      contextId: request.contextId,
      contextKey: executionContextKey(request),
      artifactId,
      phase: "accepted",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      publicChunks: [],
      runIds: [],
    };
    this.storage.transaction(() => {
      // Recheck under the insertion transaction after asynchronous SDK reduction.
      const existing = this.storage.listAllTasks();
      if (
        !existing.some(
          (t) =>
            t.task.id === task.id && t.owner === owner && t.tenant === tenant,
        ) &&
        existing.length >= this.maxTasks
      )
        throw new UnsupportedOperationError("Durable task limit reached");
      if (this.storage.getRecord("executions", id))
        throw new UnsupportedOperationError("Duplicate execution");
      this.storage.saveTask(task, request.context);
      this.put(record);
    });
  }
  async dispatched(request: ExecutionRequest): Promise<void> {
    const r = this.find(request);
    this.assertAvailable(r.contextKey, r.messageId);
    r.phase = "dispatching";
    this.put(r);
  }

  /** Prepare an idempotent SDK-reduced snapshot before publishing final events. */
  async publication(
    request: ExecutionRequest,
    events: AgentExecutionEvent[],
    confirmedStopped: boolean,
  ): Promise<void> {
    const record = this.find(request);
    const knownUnsent =
      record.phase === "accepted" || record.phase === "preparing";
    record.stopped = confirmedStopped || record.stopped === true || knownUnsent;
    const snapshot = await this.reduce(record, events);
    record.phase = "publishing";
    this.storage.transaction(() => {
      this.savePublication(record, snapshot);
      this.put(record);
    });
  }
  async waitPublished(request: ExecutionRequest): Promise<void> {
    const record = this.find(request);
    if (record.phase !== "publishing") return;
    await new Promise<void>((resolve) => {
      this.acknowledgments.set(record.id, resolve);
    });
  }
  canResume(taskId: string, c: ServerCallContext): boolean {
    const { owner, tenant } = scope(c);
    return this.attempts().some(
      (r) =>
        r.taskId === taskId &&
        r.owner === owner &&
        r.tenant === tenant &&
        r.phase === "done" &&
        r.stopped,
    );
  }
  async requestCancellation(
    taskId: string,
    c: ServerCallContext,
  ): Promise<void> {
    const { owner, tenant } = scope(c);
    for (const record of this.attempts().filter(
      (r) =>
        r.taskId === taskId &&
        r.owner === owner &&
        r.tenant === tenant &&
        r.phase !== "done",
    )) {
      record.cancelRequested = true;
      this.put(record);
    }
  }
  inspectRecovery(): RecoveryRecord[] {
    return this.attempts().filter((r) => r.phase === "unresolved");
  }
  get unresolvedContexts(): string[] {
    return [...new Set(this.inspectRecovery().map((r) => r.contextKey))];
  }

  /** Trusted operator/readback action only. Never expose as an A2A/model tool. */
  async resolveWithVerifiedStop(input: {
    attemptId: string;
    conversationId?: string;
    bindingStopped?: { bindingId: string; evidence: string };
    evidence: string;
    outcome: "completed" | "failed" | "canceled";
    text?: string;
  }): Promise<void> {
    if (this.attached)
      throw new Error("Stop the bridge before operator reconciliation");
    const record = this.storage.getRecord<RecoveryRecord>(
      "executions",
      input.attemptId,
    );
    const correlated = record?.conversationId
      ? record.conversationId === input.conversationId
      : input.bindingStopped?.bindingId === this.bindingId &&
        !!input.bindingStopped.evidence.trim();
    if (
      !record ||
      record.phase !== "unresolved" ||
      !correlated ||
      !input.evidence.trim()
    )
      throw new Error(
        "Exact unresolved attempt, conversation (or binding-wide), and verified stop evidence are required",
      );
    const state = {
      completed: TaskState.TASK_STATE_COMPLETED,
      failed: TaskState.TASK_STATE_FAILED,
      canceled: TaskState.TASK_STATE_CANCELED,
    }[input.outcome];
    record.evidence = input.bindingStopped
      ? `${input.evidence}\nBinding-wide stop: ${input.bindingStopped.evidence}`
      : input.evidence;
    record.stopped = true;
    const snapshot = await this.reduce(
      record,
      this.recoveryEvents(
        record,
        state,
        "Resolved from operator-verified stop evidence",
        input.text,
      ),
    );
    this.storage.transaction(() => {
      this.storage.saveTask(snapshot, recordContext(record));
      record.phase = "done";
      this.savePublication(record, snapshot);
      this.put(record);
    });
  }
  async prune(before: number): Promise<number> {
    if (!Number.isFinite(before)) throw new Error("Invalid retention cutoff");
    let count = 0;
    for (const { task, owner, tenant } of this.storage.listAllTasks()) {
      const records = this.attempts().filter(
        (r) => r.taskId === task.id && r.owner === owner && r.tenant === tenant,
      );
      if (
        !task.status ||
        !finalStates.has(task.status.state) ||
        records.length === 0 ||
        records.some(
          (r) => r.phase !== "done" || !r.stopped || r.updatedAt >= before,
        )
      )
        continue;
      const timestamp = Date.parse(task.status.timestamp ?? "");
      if (!Number.isFinite(timestamp) || timestamp >= before) continue;
      this.storage.transaction(() => {
        this.storage.deleteTask(task.id, recordContext(records[0]!));
        for (const r of records) {
          this.storage.deleteRecord("executions", r.id);
          this.storage.deleteRecord("publications", r.id);
        }
      });
      count++;
    }
    // Mappings and deduplication tombstones are deliberately retained.
    return count;
  }
  private async reduce(
    record: RecoveryRecord,
    events: AgentExecutionEvent[],
  ): Promise<Task> {
    const c = recordContext(record),
      current = await this.storage.load(record.taskId, c);
    if (!current) throw new Error("Missing persisted task during recovery");
    const memory = new InMemoryTaskStore();
    await memory.save(current, c);
    const reducer = new ResultManager(memory, c);
    for (const event of events) await reducer.processEvent(event);
    return (await memory.load(record.taskId, c))!;
  }
  private savedPublication(record: RecoveryRecord): Task {
    const value = this.storage.getRecord("publications", record.id);
    if (!value)
      throw new Error("Invalid recovery: missing publication snapshot");
    return Task.fromJSON(value);
  }
  private savePublication(
    record: RecoveryRecord,
    task: Task,
    recovery = false,
  ): void {
    const value = Task.toJSON(task);
    // A repaired snapshot combines admitted task/history + public observations.
    // Reserve derived capacity; never duplicate the full output in its journal row.
    // Reopen must preserve already-admitted data even if a budget was lowered.
    // Admission/observation validate the actual derived representation beforehand.
    if (!recovery) this.assertSize(value, 3);
    this.storage.setRecord("publications", record.id, value);
    record.publication = true;
    record.publicChunks = [];
    delete record.resultText;
  }
  private recoveryEvents(
    record: RecoveryRecord,
    state: TaskState,
    detail: string,
    text?: string,
  ): AgentExecutionEvent[] {
    const chunks =
      text !== undefined
        ? [text]
        : record.publicChunks.length
          ? record.publicChunks
          : record.resultText
            ? [record.resultText]
            : [];
    const events: AgentExecutionEvent[] = [];
    if (chunks.length)
      events.push(
        AgentEvent.artifactUpdate({
          taskId: record.taskId,
          contextId: record.contextId,
          artifact: {
            artifactId: record.artifactId,
            name: "Letta response",
            description: "Public assistant text from the Letta turn.",
            parts: chunks.map(textPart),
            metadata: undefined,
            extensions: [],
          },
          append: false,
          lastChunk: record.stopped === true,
          metadata: undefined,
        }),
      );
    events.push(
      AgentEvent.statusUpdate({
        taskId: record.taskId,
        contextId: record.contextId,
        status: {
          state,
          timestamp: new Date().toISOString(),
          message: agentMessage(detail, record.taskId, record.contextId),
        },
        metadata: undefined,
      }),
    );
    return events;
  }
  private async recover(): Promise<void> {
    for (const record of this.attempts()) {
      if (record.phase === "done") continue;
      if (record.phase === "unresolved" && record.publication) continue;
      if (record.phase === "publishing" && record.publication) {
        this.storage.transaction(() => {
          this.storage.saveTask(
            this.savedPublication(record),
            recordContext(record),
          );
          record.phase = record.stopped ? "done" : "unresolved";
          this.put(record, true);
        });
        continue;
      }
      const unsent =
        record.phase === "accepted" || record.phase === "preparing";
      const stopped = record.phase === "stopped" && record.stopped === true;
      record.stopped = unsent || stopped;
      const snapshot = await this.reduce(
        record,
        this.recoveryEvents(
          record,
          stopped
            ? TaskState.TASK_STATE_COMPLETED
            : TaskState.TASK_STATE_FAILED,
          stopped
            ? "Recovered a stopped successful turn"
            : unsent
              ? "Controller stopped before input submission; no input was sent"
              : "Execution status is unknown; operator reconciliation is required",
        ),
      );
      this.storage.transaction(() => {
        this.storage.saveTask(snapshot, recordContext(record));
        record.phase = record.stopped ? "done" : "unresolved";
        this.savePublication(record, snapshot, true);
        this.put(record, true);
      });
    }
  }
}
