import { expect, test } from "bun:test";
import { createAgentToolGuard } from "../src/tool-policy.js";

test("existing-agent governance is read-only and checked again each turn", async () => {
  let tools: unknown = [];
  let reads = 0;
  const guard = createAgentToolGuard(
    {
      agents: {
        async retrieve(id: string) {
          reads++;
          return { id, tools };
        },
      },
    },
    "agent",
  );
  await guard(new AbortController().signal);
  tools = [{ id: "unapproved", name: "write_database" }];
  await expect(guard(new AbortController().signal)).rejects.toThrow(
    "unapproved",
  );
  expect(reads).toBe(2);
  expect(tools).toEqual([{ id: "unapproved", name: "write_database" }]);
});

test("allowlisting pins tool IDs, not just names", async () => {
  let tools: unknown = [{ id: "tool-approved", name: "lookup" }];
  const guard = createAgentToolGuard(
    {
      agents: {
        async retrieve(id: string) {
          return { id, tools };
        },
      },
    },
    "agent",
    { allowedToolIds: ["tool-approved"] },
  );
  await guard(new AbortController().signal);
  tools = [{ id: "different", name: "lookup" }];
  await expect(guard(new AbortController().signal)).rejects.toThrow(
    "unapproved",
  );
  tools = ["lookup"];
  await expect(guard(new AbortController().signal)).rejects.toThrow("identity");
});

test("missing inventory or a different returned agent fails closed", async () => {
  const signal = new AbortController().signal;
  await expect(
    createAgentToolGuard(
      {
        agents: {
          async retrieve() {
            return { id: "other", tools: [] };
          },
        },
      },
      "agent",
    )(signal),
  ).rejects.toThrow("identity");
  await expect(
    createAgentToolGuard(
      {
        agents: {
          async retrieve(id: string) {
            return { id };
          },
        },
      },
      "agent",
    )(signal),
  ).rejects.toThrow("inventory");
});

test("governance timeout does not permit execution and pre-abort never reads", async () => {
  let reads = 0;
  const guard = createAgentToolGuard(
    {
      agents: {
        retrieve() {
          reads++;
          return new Promise<never>(() => {});
        },
      },
    },
    "agent",
    { timeoutMs: 10 },
  );
  const owner = new AbortController();
  owner.abort();
  await expect(guard(owner.signal)).rejects.toThrow();
  expect(reads).toBe(0);
  await expect(guard(new AbortController().signal)).rejects.toThrow(
    "timed out",
  );
});
