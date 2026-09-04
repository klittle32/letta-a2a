import { randomUUID, timingSafeEqual } from "node:crypto";

import type {
  StreamResponse,
  TaskPushNotificationConfig,
} from "@a2a-js/sdk";
import {
  InMemoryPushNotificationStore,
  type PushNotificationSender,
  type PushNotificationStore,
  type ServerCallContext,
  type StoredPushNotificationConfig,
  V1PushNotificationSerializer,
} from "@a2a-js/sdk/server";

const MAX_URL_LENGTH = 2_048;
const MAX_CREDENTIAL_LENGTH = 1_024;

export class ValidatingPushNotificationStore
  implements PushNotificationStore
{
  private readonly delegate = new InMemoryPushNotificationStore();
  private readonly callbackUrl: string;

  constructor(
    callbackUrl: string,
    private readonly bearerToken: string,
  ) {
    this.callbackUrl = validateConfiguredCallback(callbackUrl);
    if (!bearerToken || bearerToken.length > MAX_CREDENTIAL_LENGTH) {
      throw new Error("push callback Bearer token has an invalid length");
    }
  }

  async save(
    taskId: string,
    context: ServerCallContext,
    config: TaskPushNotificationConfig,
  ): Promise<void> {
    this.assertValid(taskId, context.requestedVersion, config);
    config.taskId = taskId;
    if (!config.id) config.id = randomUUID();
    await this.delegate.save(taskId, context, structuredClone(config));
  }

  async load(
    taskId: string,
    context: ServerCallContext,
  ): Promise<TaskPushNotificationConfig[]> {
    const configs = await this.delegate.load(taskId, context);
    return configs.map(redactCredentials);
  }

  async loadWithMetadata(
    taskId: string,
    context: ServerCallContext,
  ): Promise<StoredPushNotificationConfig[]> {
    return this.delegate.loadWithMetadata(taskId, context);
  }

  async delete(
    taskId: string,
    context: ServerCallContext,
    configId?: string,
  ): Promise<void> {
    await this.delegate.delete(taskId, context, configId);
  }

  assertValid(
    taskId: string,
    wireVersion: string,
    config: TaskPushNotificationConfig,
  ): void {
    if (wireVersion !== "1.0") {
      throw new Error("push callbacks are supported only over A2A 1.0");
    }
    if (config.taskId && config.taskId !== taskId) {
      throw new Error("push callback task ID does not match the target task");
    }
    if (config.url !== this.callbackUrl) {
      throw new Error("push callback URL is not on the deployment allowlist");
    }
    if (config.token) {
      throw new Error("legacy push callback tokens are not accepted");
    }
    const authentication = config.authentication;
    if (
      authentication?.scheme !== "Bearer" ||
      !sameSecret(authentication.credentials, this.bearerToken)
    ) {
      throw new Error("push callback requires the configured Bearer credential");
    }
  }
}

interface SenderOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class LabPushNotificationSender implements PushNotificationSender {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly serializer = new V1PushNotificationSerializer();
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    private readonly store: ValidatingPushNotificationStore,
    options: SenderOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("push callback timeout must be a positive integer");
    }
  }

  async send(
    streamResponse: StreamResponse,
    context: ServerCallContext,
  ): Promise<void> {
    const taskId = taskIdFromResponse(streamResponse);
    if (!taskId) return;
    const previous = this.chains.get(taskId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.dispatch(taskId, streamResponse, context));
    this.chains.set(taskId, current);
    try {
      await current;
    } finally {
      if (this.chains.get(taskId) === current) this.chains.delete(taskId);
    }
  }

  private async dispatch(
    taskId: string,
    streamResponse: StreamResponse,
    context: ServerCallContext,
  ): Promise<void> {
    const configs = await this.store.loadWithMetadata(taskId, context);
    const serialized = this.serializer.serialize(streamResponse);
    await Promise.all(
      configs.map(async ({ config, wireVersion }) => {
        try {
          this.store.assertValid(taskId, wireVersion, config);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
          try {
            const response = await this.fetchImpl(config.url, {
              method: "POST",
              headers: {
                Authorization: `${config.authentication!.scheme} ${config.authentication!.credentials}`,
                "Content-Type": serialized.contentType,
              },
              body: serialized.body,
              redirect: "error",
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(`callback returned HTTP ${response.status}`);
            }
          } finally {
            clearTimeout(timeout);
          }
        } catch {
          console.warn("Push notification delivery failed");
        }
      }),
    );
  }
}

function validateConfiguredCallback(raw: string): string {
  if (!raw || raw.length > MAX_URL_LENGTH) {
    throw new Error("push callback URL has an invalid length");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("push callback URL must be absolute");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.href !== raw
  ) {
    throw new Error("configured push callback URL is not canonical");
  }
  return raw;
}

function redactCredentials(
  config: TaskPushNotificationConfig,
): TaskPushNotificationConfig {
  return {
    ...structuredClone(config),
    token: "",
    authentication: config.authentication
      ? { ...config.authentication, credentials: "" }
      : undefined,
  };
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function taskIdFromResponse(response: StreamResponse): string {
  const payload = response.payload;
  if (!payload) return "";
  return payload.$case === "task" ? payload.value.id : payload.value.taskId;
}
