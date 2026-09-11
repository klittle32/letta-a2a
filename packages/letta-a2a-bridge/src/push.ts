import { randomUUID, timingSafeEqual } from "node:crypto";
import type { StreamResponse, TaskPushNotificationConfig } from "@a2a-js/sdk";
import {
  InMemoryPushNotificationStore,
  resolveUserScope,
  V1PushNotificationSerializer,
  type OwnerResolver,
  type PushNotificationSender,
  type PushNotificationStore,
  type ServerCallContext,
} from "@a2a-js/sdk/server";

export interface PushDeliveryEvent {
  taskId: string;
  configId: string;
  attempt: number;
  status: "delivered" | "failed" | "retrying" | "aborted";
}

export interface PushNotificationsOptions {
  /** Host-owned exact URL/credential bindings; an empty policy is invalid. */
  callbacks: readonly { url: string; bearerToken: string }[];
  ownerResolver?: OwnerResolver;
  /** Total time budget for each config delivery, including retries. */
  timeoutMs?: number;
  retryCount?: number;
  backoffMs?: number;
  closeTimeoutMs?: number;
  fetchImpl?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  onDelivery?: (event: PushDeliveryEvent) => void;
}

function bounded(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new Error("Invalid push delivery bound");
  }
  return result;
}

function validCredential(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 1024 &&
    /^[A-Za-z0-9._~+/-]+=*$/.test(value)
  );
}

function redact(
  config: TaskPushNotificationConfig,
): TaskPushNotificationConfig {
  const copy = structuredClone(config);
  copy.token = "";
  if (copy.authentication) copy.authentication.credentials = "";
  return copy;
}

/** Advisory delivery only: failures never change task state or escape send(). */
export function createPushNotifications(options: PushNotificationsOptions): {
  store: PushNotificationStore;
  sender: PushNotificationSender;
  close(): Promise<{ complete: boolean; pending: number }>;
} {
  const timeoutMs = bounded(options.timeoutMs, 5000, 1, 60_000);
  const retryCount = bounded(options.retryCount, 2, 0, 10);
  const backoffMs = bounded(options.backoffMs, 100, 0, 10_000);
  const closeTimeoutMs = bounded(options.closeTimeoutMs, 1000, 1, 60_000);
  if (!Array.isArray(options.callbacks) || options.callbacks.length === 0) {
    throw new Error("Push requires a host callback policy");
  }
  const bindings = new Map<string, string>();
  for (const entry of options.callbacks) {
    let parsed: URL;
    try {
      parsed = new URL(entry.url);
    } catch {
      throw new Error("Invalid push callback policy");
    }
    if (
      entry.url.length > 2048 ||
      parsed.href !== entry.url ||
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !validCredential(entry.bearerToken) ||
      bindings.has(entry.url)
    ) {
      throw new Error("Invalid push callback policy");
    }
    bindings.set(entry.url, entry.bearerToken);
  }
  const ownerResolver = options.ownerResolver ?? resolveUserScope;
  const delegate = new InMemoryPushNotificationStore(ownerResolver);
  let closed = false;

  function validate(
    taskId: string,
    version: string,
    config: TaskPushNotificationConfig,
  ): void {
    const secret = bindings.get(config.url);
    const supplied = config.authentication?.credentials;
    if (
      version !== "1.0" ||
      !taskId ||
      (config.taskId && config.taskId !== taskId) ||
      (config.token !== "" && config.token !== undefined) ||
      config.authentication?.scheme !== "Bearer" ||
      !secret ||
      !validCredential(supplied) ||
      Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
      !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))
    ) {
      throw new Error("Push registration rejected by host policy");
    }
  }

  const store: PushNotificationStore = {
    async save(taskId, context, config) {
      if (closed) throw new Error("Push is closed");
      validate(taskId, context.requestedVersion, config);
      const privateConfig = structuredClone(config);
      privateConfig.taskId = taskId;
      privateConfig.id ||= randomUUID();
      await delegate.save(taskId, context, privateConfig);
      // The SDK returns this same object from Create. Replace authentication
      // rather than modifying the caller's potentially shared nested object.
      Object.assign(config, redact(privateConfig));
    },
    async load(taskId, context) {
      return (await delegate.load(taskId, context)).map(redact);
    },
    async loadWithMetadata(taskId, context) {
      return structuredClone(await delegate.loadWithMetadata(taskId, context));
    },
    async delete(taskId, context, configId) {
      await delegate.delete(taskId, context, configId);
    },
  };
  const serializer = new V1PushNotificationSerializer();
  const fetchImpl = options.fetchImpl ?? fetch;
  const chains = new Map<string, Promise<void>>();
  const controllers = new Set<AbortController>();
  // Track each transport through response-body cleanup, independently of the
  // delivery race. Abort and stream cancellation may both be noncooperative;
  // close remains bounded and reports their outstanding lifecycle promises.
  const transports = new Set<Promise<unknown>>();

  function report(event: PushDeliveryEvent): void {
    try {
      void Promise.resolve(options.onDelivery?.(event)).catch(() => {});
    } catch {
      /* Observers are advisory too. */
    }
  }

  async function dispatch(
    taskId: string,
    response: StreamResponse,
    context: ServerCallContext,
  ): Promise<void> {
    if (closed) return;
    const configs = await delegate.loadWithMetadata(taskId, context);
    const serialized = serializer.serialize(response);
    for (const { config, wireVersion } of configs) {
      if (closed) return;
      validate(taskId, wireVersion, config);
      const controller = new AbortController();
      controllers.add(controller);
      let abortListener: () => void = () => {};
      const aborted = new Promise<undefined>((resolve) => {
        abortListener = () => resolve(undefined);
        controller.signal.addEventListener("abort", abortListener, {
          once: true,
        });
      });
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        for (let attempt = 1; attempt <= retryCount + 1; attempt++) {
          if (controller.signal.aborted || closed) break;
          const transport = Promise.resolve().then(() =>
            fetchImpl(config.url, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${config.authentication!.credentials}`,
                "Content-Type": serialized.contentType,
              },
              body: serialized.body,
              // Manual mode distinguishes a redirect from a retryable network
              // failure and never follows its Location header.
              redirect: "manual",
              signal: controller.signal,
            }),
          );
          // Install cleanup on the transport itself, not the local race: a
          // late response still owns an open body even after send has returned.
          // Delivery does not await cancellation, but shutdown tracks it.
          const lifecycle = transport.then(async (response) => {
            await response.body?.cancel();
          });
          transports.add(lifecycle);
          void lifecycle.then(
            () => transports.delete(lifecycle),
            () => transports.delete(lifecycle),
          );
          const result = await Promise.race([
            transport.then(
              (value) => ({ value }),
              () => ({ value: undefined }),
            ),
            aborted,
          ]);
          if (!result || controller.signal.aborted) {
            report({ taskId, configId: config.id, attempt, status: "aborted" });
            break;
          }
          const http = result.value;
          const success = !!http && http.ok && !http.redirected;
          const transient =
            !http ||
            (!http.redirected &&
              (http.status === 429 ||
                (http.status >= 500 && http.status <= 599)));
          const retry = !success && transient && attempt <= retryCount;
          report({
            taskId,
            configId: config.id,
            attempt,
            status: success ? "delivered" : retry ? "retrying" : "failed",
          });
          if (!retry) break;
          let delayTimer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            new Promise<void>((resolve) => {
              delayTimer = setTimeout(
                resolve,
                Math.min(backoffMs * attempt, 10_000),
              );
            }),
            aborted,
          ]);
          clearTimeout(delayTimer);
        }
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", abortListener);
        controllers.delete(controller);
      }
    }
  }

  const sender: PushNotificationSender = {
    async send(response, context) {
      if (closed || context.requestedVersion !== "1.0") return;
      try {
        const payload = response.payload;
        const taskId =
          payload?.$case === "task" ? payload.value.id : payload?.value.taskId;
        if (!taskId) return;
        const key = JSON.stringify([
          context.tenant ?? "",
          ownerResolver(context),
          taskId,
        ]);
        const snapshot = structuredClone(response);
        const previous = chains.get(key) ?? Promise.resolve();
        // Never remove a waiting link early: later sends must remain behind it.
        const current = previous
          .then(() => dispatch(taskId, snapshot, context))
          .catch(() => {});
        chains.set(key, current);
        await current;
        if (chains.get(key) === current) chains.delete(key);
      } catch {
        /* GetTask remains authoritative; do not expose raw errors. */
      }
    },
  };

  return {
    store,
    sender,
    async close() {
      closed = true;
      for (const controller of controllers) controller.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...chains.values(), ...transports]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, closeTimeoutMs);
        }),
      ]);
      clearTimeout(timer);
      const pending = transports.size + chains.size;
      return { complete: pending === 0, pending };
    },
  };
}
