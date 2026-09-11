import { describe, expect, test } from "bun:test";
import { StreamResponse, TaskPushNotificationConfig } from "@a2a-js/sdk";
import {
  ServerCallContext,
  V1PushNotificationSerializer,
} from "@a2a-js/sdk/server";
import { createPushNotifications } from "../src/push.js";

const url = "https://callback.example/events";
const context = new ServerCallContext({ requestedVersion: "1.0" });
const config = (id = "one") =>
  TaskPushNotificationConfig.fromJSON({
    taskId: "task",
    id,
    url,
    authentication: { scheme: "Bearer", credentials: "secret" },
  });
const event = StreamResponse.fromJSON({
  task: {
    id: "task",
    contextId: "ctx",
    status: { state: "TASK_STATE_WORKING" },
  },
});
const policy = {
  callbacks: [{ url, bearerToken: "secret" }],
  timeoutMs: 100,
  backoffMs: 1,
  closeTimeoutMs: 20,
};

describe("governed push", () => {
  test("validates policy and registrations without fetching", async () => {
    for (const callbacks of [
      [],
      [{ url: "https://CALLBACK.example/events", bearerToken: "secret" }],
      [{ url, bearerToken: " secret" }],
    ]) {
      expect(() => createPushNotifications({ callbacks })).toThrow();
    }
    const pair = createPushNotifications(policy);
    for (const patch of [
      { url: "https://evil.example/" },
      { taskId: "other" },
      { token: "legacy" },
      { authentication: { scheme: "Basic", credentials: "secret" } },
    ]) {
      await expect(
        pair.store.save("task", context, { ...config(), ...patch }),
      ).rejects.toThrow();
    }
    await expect(
      pair.store.save("task", new ServerCallContext(), config()),
    ).rejects.toThrow();
    await pair.close();
  });

  test("redacts SDK create echo and loads without mutating shared authentication; isolates scopes", async () => {
    const pair = createPushNotifications({
      ...policy,
      ownerResolver: (c) => String(c.state.get("owner") ?? "a"),
    });
    const input = config("");
    const authentication = input.authentication!;
    await pair.store.save("task", context, input);
    expect(input.id).not.toBe("");
    expect(input.authentication?.credentials).toBe("");
    expect(authentication.credentials).toBe("secret");
    expect(
      (await pair.store.load("task", context))[0]?.authentication?.credentials,
    ).toBe("");
    const metadata = await pair.store.loadWithMetadata!("task", context);
    expect(metadata[0]?.config.authentication?.credentials).toBe("secret");
    metadata[0]!.config.url = "changed";
    expect(
      (await pair.store.loadWithMetadata!("task", context))[0]?.config.url,
    ).toBe(url);
    for (const c of [
      new ServerCallContext({ tenant: "other" }),
      new ServerCallContext({ state: new Map([["owner", "b"]]) }),
    ]) {
      expect(await pair.store.load("task", c)).toEqual([]);
      await pair.store.delete("task", c);
    }
    expect(await pair.store.load("other", context)).toEqual([]);
    await pair.store.save("task", context, config("two"));
    await pair.store.delete("task", context, input.id);
    expect((await pair.store.load("task", context)).map((c) => c.id)).toEqual([
      "two",
    ]);
    await pair.close();
  });

  test("retries transient responses with identical V1 body, never client errors or redirects", async () => {
    for (const status of [429, 503, 400, 302]) {
      const requests: RequestInit[] = [];
      const pair = createPushNotifications({
        ...policy,
        retryCount: 2,
        fetchImpl: async (_url, init) => {
          requests.push(init!);
          return new Response(null, {
            status: requests.length === 1 ? status : 200,
          });
        },
      });
      await pair.store.save("task", context, config());
      await pair.sender.send(event, context);
      expect(requests.length).toBe(status >= 500 || status === 429 ? 2 : 1);
      expect(
        requests.every(
          (r) =>
            r.body ===
              new V1PushNotificationSerializer().serialize(event).body &&
            r.redirect === "manual",
        ),
      ).toBe(true);
      await pair.close();
    }
  });

  test("network retries, queue ordering and advisory errors", async () => {
    const bodies: unknown[] = [];
    const pair = createPushNotifications({
      ...policy,
      retryCount: 1,
      onDelivery: () => {
        throw new Error("observer");
      },
      fetchImpl: async (_url, init) => {
        bodies.push(init?.body);
        if (bodies.length === 1) throw new Error("secret URL");
        return new Response(null, { status: 200 });
      },
    });
    await pair.store.save("task", context, config());
    const second = structuredClone(event);
    await Promise.all([
      pair.sender.send(event, context),
      pair.sender.send(second, context),
    ]);
    expect(bodies.length).toBe(3);
    expect(bodies[0]).toBe(bodies[1]);
    await pair.close();
  });

  test("holds queued sends behind the active delivery and drains on close", async () => {
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const bodies: unknown[] = [];
    const pair = createPushNotifications({
      ...policy,
      fetchImpl: async (_url, init) => {
        bodies.push(init?.body);
        if (bodies.length === 1) {
          started!();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return new Response(null, { status: 200 });
      },
    });
    await pair.store.save("task", context, config());
    const first = pair.sender.send(event, context);
    await ready;
    const second = pair.sender.send(
      StreamResponse.fromJSON({ task: { id: "task", contextId: "second" } }),
      context,
    );
    const third = pair.sender.send(
      StreamResponse.fromJSON({ task: { id: "task", contextId: "third" } }),
      context,
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(bodies.length).toBe(1);
    release!();
    await Promise.all([first, second, third]);
    expect(String(bodies[1])).toContain("second");
    expect(String(bodies[2])).toContain("third");
    expect(await pair.close()).toEqual({ complete: true, pending: 0 });
    await expect(pair.store.save("task", context, config())).rejects.toThrow();
  });

  test("close aborts active delivery and skips queued sends", async () => {
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    const pair = createPushNotifications({
      ...policy,
      fetchImpl: async (_url, init) => {
        calls++;
        started!();
        return new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new Error("private transport details")),
            { once: true },
          );
        });
      },
    });
    await pair.store.save("task", context, config());
    const first = pair.sender.send(event, context);
    await ready;
    const second = pair.sender.send(event, context);
    expect(await pair.close()).toEqual({ complete: true, pending: 0 });
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  test("cancels late response bodies and tracks noncooperative cleanup through bounded close", async () => {
    for (const slowCleanup of [false, true]) {
      let deliver!: (response: Response) => void;
      let finishCleanup!: () => void;
      let canceled = 0;
      const cleanup = new Promise<void>((resolve) => {
        finishCleanup = resolve;
      });
      const pair = createPushNotifications({
        ...policy,
        timeoutMs: 10,
        fetchImpl: () =>
          new Promise<Response>((resolve) => {
            deliver = resolve;
          }),
      });
      await pair.store.save("task", context, config());
      await pair.sender.send(event, context);
      expect(await pair.close()).toEqual({ complete: false, pending: 1 });
      deliver(
        new Response(
          new ReadableStream({
            cancel() {
              canceled++;
              return slowCleanup ? cleanup : undefined;
            },
          }),
        ),
      );
      const started = performance.now();
      expect(await pair.close()).toEqual({
        complete: !slowCleanup,
        pending: slowCleanup ? 1 : 0,
      });
      expect(performance.now() - started).toBeLessThan(250);
      expect(canceled).toBe(1);
      finishCleanup();
      expect(await pair.close()).toEqual({ complete: true, pending: 0 });
    }
  });

  test("bounds noncooperative fetch, aborts signal, reports pending at close", async () => {
    let signal: AbortSignal | undefined;
    const pair = createPushNotifications({
      ...policy,
      timeoutMs: 20,
      fetchImpl: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      },
    });
    await pair.store.save("task", context, config());
    await pair.sender.send(event, context);
    expect(signal?.aborted).toBe(true);
    expect(await pair.close()).toEqual({ complete: false, pending: 1 });
    await pair.sender.send(event, context);
    expect(await pair.close()).toEqual({ complete: false, pending: 1 });
  });
});
