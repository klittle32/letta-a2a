import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TaskState } from "@a2a-js/sdk";

const worker = fileURLToPath(
  new URL("./fixtures/durable-crash-worker.ts", import.meta.url),
);
interface Checkpoint {
  checkpoint: true;
  taskId: string;
  status?: TaskState;
  artifacts?: unknown[];
  history?: unknown[];
  detail?: unknown;
  unresolved?: {
    taskId?: string;
    phase: string;
    otid?: string;
    conversationId?: string;
    sendReturned?: boolean;
    cancelRequested?: boolean;
  }[];
  queuedTaskId?: string;
  sessionsOpened?: number;
  statuses?: TaskState[];
  rejections?: boolean[];
  cancellationRejected?: boolean;
  cancellationState?: TaskState;
  duplicateRejected?: boolean;
  nextContextRejected?: boolean;
  subscriptionRejected?: boolean;
  subscriptionSnapshot?: boolean;
  subscriptionEnded?: boolean;
  pruned?: number;
  prunedTaskMissing?: boolean;
  tombstoneRejected?: boolean;
}

async function killAtCheckpoint(
  directory: string,
  counter: string,
  phase: string,
  action = "crash",
  taskId = "",
): Promise<Checkpoint> {
  const child = spawn(
    process.execPath,
    [worker, directory, counter, phase, action, taskId],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let stdout = "";
  let stderr = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const checkpoint = await new Promise<Checkpoint>((resolve, reject) => {
      child.stdout!.on("data", (chunk) => {
        stdout += chunk.toString();
        for (const line of stdout.split("\n")) {
          if (!line.startsWith('{"checkpoint":')) continue;
          try {
            resolve(JSON.parse(line));
          } catch {}
        }
      });
      child.stderr!.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.once("error", reject);
      void exited.then(({ code, signal }) =>
        reject(
          new Error(
            `Worker exited before ${phase}/${action} checkpoint (${code}/${signal}): ${stderr}`,
          ),
        ),
      );
      timer = setTimeout(
        () =>
          reject(
            new Error(`Worker timed out at ${phase}/${action}: ${stderr}`),
          ),
        8000,
      );
    });
    child.kill("SIGKILL");
    expect((await exited).signal).toBe("SIGKILL");
    return checkpoint;
  } finally {
    if (timer) clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited;
  }
}

test("SIGKILL with a live SDK turn and a same-context queued turn fences both on repeated restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "a2a-durable-queued-"));
  const directory = join(root, "binding");
  const counter = join(root, "remote-calls.log");
  await writeFile(counter, "");
  try {
    const crashed = await killAtCheckpoint(directory, counter, "queued");
    expect(crashed.queuedTaskId).toBeTruthy();
    expect(crashed.queuedTaskId).not.toBe(crashed.taskId);
    expect(crashed.sessionsOpened).toBe(1);
    expect(crashed.statuses).toEqual([
      TaskState.TASK_STATE_WORKING,
      TaskState.TASK_STATE_WORKING,
    ]);
    expect(await readFile(counter, "utf8")).toBe("sdk-send\n");
    const ids = [crashed.taskId, crashed.queuedTaskId!];
    for (let restart = 0; restart < 2; restart++) {
      const recovered = await killAtCheckpoint(
        directory,
        counter,
        "queued",
        "inspect",
        JSON.stringify(ids),
      );
      expect(recovered.statuses).toEqual([
        TaskState.TASK_STATE_FAILED,
        TaskState.TASK_STATE_FAILED,
      ]);
      expect(recovered.unresolved).toHaveLength(2);
      expect(recovered.unresolved!.map((r) => r.taskId).sort()).toEqual(
        [...ids].sort(),
      );
      expect(recovered.unresolved!.every((r) => r.phase === "unresolved")).toBe(
        true,
      );
      expect(recovered.rejections).toEqual([true, true, true]);
      expect(recovered.sessionsOpened).toBe(0);
      expect(await readFile(counter, "utf8")).toBe("sdk-send\n");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 40000);

test("protocol cancellation after intent recovery persists intent without claiming canceled or releasing the fence", async () => {
  const root = await mkdtemp(join(tmpdir(), "a2a-durable-restart-cancel-"));
  const directory = join(root, "binding");
  const counter = join(root, "remote-calls.log");
  await writeFile(counter, "");
  try {
    const crashed = await killAtCheckpoint(directory, counter, "intent");
    for (const action of ["cancel", "inspect", "inspect"]) {
      const recovered = await killAtCheckpoint(
        directory,
        counter,
        "intent",
        action,
        crashed.taskId,
      );
      if (action === "cancel") {
        expect(recovered.cancellationRejected).toBe(true);
        expect(recovered.cancellationState).not.toBe(
          TaskState.TASK_STATE_CANCELED,
        );
      }
      expect(recovered.status).toBe(TaskState.TASK_STATE_FAILED);
      expect(recovered.unresolved).toHaveLength(1);
      expect(recovered.unresolved![0]).toMatchObject({
        phase: "unresolved",
        cancelRequested: true,
        otid: "original-message",
        conversationId: "fake-conversation",
      });
      expect(recovered.duplicateRejected).toBe(true);
      expect(recovered.nextContextRejected).toBe(true);
      expect(await readFile(counter, "utf8")).toBe("");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 40000);

const phases = [
  "accepted",
  "intent",
  "sent",
  "result",
  "stopped",
  "publication",
  "completed",
  "interrupted",
] as const;
for (const phase of phases) {
  test(`SIGKILL ${phase}: reopen repairs or quarantines without another remote send`, async () => {
    const root = await mkdtemp(join(tmpdir(), `a2a-durable-crash-${phase}-`));
    const directory = join(root, "binding");
    // External append-only fake remote call counter survives every controller death.
    const counter = join(root, "remote-calls.log");
    await writeFile(counter, "");
    const calls = async () =>
      (await readFile(counter, "utf8")).trim().split("\n").filter(Boolean)
        .length;
    try {
      const crashed = await killAtCheckpoint(directory, counter, phase);
      expect(crashed.taskId).not.toBe("");
      const expectedCalls = phase === "accepted" || phase === "intent" ? 0 : 1;
      expect(await calls()).toBe(expectedCalls);
      const unknown =
        phase === "intent" || phase === "sent" || phase === "result";
      const expectedState =
        phase === "interrupted"
          ? TaskState.TASK_STATE_INPUT_REQUIRED
          : unknown || phase === "accepted"
            ? TaskState.TASK_STATE_FAILED
            : TaskState.TASK_STATE_COMPLETED;

      let previous: Checkpoint | undefined;
      for (let restart = 0; restart < 2; restart++) {
        const recovered = await killAtCheckpoint(
          directory,
          counter,
          phase,
          "inspect",
          crashed.taskId,
        );
        expect(recovered.status).toBe(expectedState);
        expect(recovered.duplicateRejected).toBe(true);
        expect(await calls()).toBe(expectedCalls);
        if (unknown) {
          expect(recovered.unresolved).toHaveLength(1);
          expect(recovered.unresolved![0]).toMatchObject({
            phase: "unresolved",
            otid: "original-message",
            conversationId: "fake-conversation",
          });
          if (phase !== "intent")
            expect(recovered.unresolved![0]!.sendReturned).toBe(true);
          expect(recovered.nextContextRejected).toBe(true);
          expect(JSON.stringify(recovered.detail)).toMatch(
            /unknown|reconciliation/i,
          );
        } else expect(recovered.unresolved).toEqual([]);
        if (phase === "interrupted") {
          expect(recovered.subscriptionSnapshot).toBe(true);
          expect(recovered.subscriptionEnded).toBe(true);
          expect(recovered.subscriptionRejected).toBe(false);
        } else expect(recovered.subscriptionRejected).toBe(true);
        if (
          phase === "stopped" ||
          phase === "publication" ||
          phase === "completed"
        ) {
          expect(JSON.stringify(recovered.artifacts)).toContain(
            "durable answer",
          );
          expect(recovered.artifacts).toHaveLength(1);
        }
        if (previous) {
          // Replaying repair cannot multiply or replace artifact/history identity.
          expect(recovered.artifacts).toEqual(previous.artifacts);
          expect(recovered.history).toEqual(previous.history);
        }
        previous = recovered;
      }

      const retention = await killAtCheckpoint(
        directory,
        counter,
        phase,
        "prune",
        crashed.taskId,
      );
      const shouldPrune = !unknown && phase !== "interrupted";
      expect(retention.pruned).toBe(shouldPrune ? 1 : 0);
      if (shouldPrune) {
        expect(retention.prunedTaskMissing).toBe(true);
        expect(retention.tombstoneRejected).toBe(true);
      }
      expect(await calls()).toBe(expectedCalls);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 40000);
}
