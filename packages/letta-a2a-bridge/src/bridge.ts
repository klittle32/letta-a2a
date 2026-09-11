import express from "express";
import {
  A2A_PROTOCOL_VERSION,
  AGENT_CARD_PATH,
  AgentCard,
  type SendMessageRequest,
} from "@a2a-js/sdk";
import {
  ContentTypeNotSupportedError,
  RequestMalformedError,
  TaskNotFoundError,
  UnsupportedOperationError,
  PushNotificationNotSupportedError,
} from "@a2a-js/sdk/errors";
import { TaskState } from "@a2a-js/sdk";
import type { RequestHandler } from "express";
import {
  RequestPolicy,
  validateHistory,
  BridgeAccessError,
  type BridgeAuthorization,
} from "./request-policy.js";
import { readText } from "./a2a-text.js";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  ServerCallContext,
  type A2ARequestHandler,
  type PushNotificationStore,
  type PushNotificationSender,
  type TaskStore,
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import type { LettaAgentClient } from "@letta-ai/letta-agent-sdk";
import {
  AgentSdkTurnRunner,
  type LettaTurnRunner,
  type SessionPolicy,
} from "./letta-agent.js";
import {
  LettaAgentExecutor,
  type CloseResult,
} from "./letta-agent-executor.js";

export interface PushCloseResult {
  complete: boolean;
  pending?: number;
}
export interface BridgeCloseResult extends CloseResult {
  push?: PushCloseResult;
}

export interface BridgeOptions {
  /** Verified caller projection and action policy. One agent remains one memory trust domain. */
  auth?: BridgeAuthorization;
  /** Application-owned advertisement of its actual transport authentication.
   * No Bearer/OAuth scheme is guessed from a caller projection function. */
  security?: Pick<AgentCard, "securitySchemes" | "securityRequirements">;
  /** Trusted SDK Express composition. Middleware validates credentials before userBuilder;
   * userBuilder returns app-verified users consumed by auth.projectCaller.
   * Required by listenLoopback when auth is configured; no JWT provider is included. */
  transport?: { userBuilder: UserBuilder; middleware?: RequestHandler[] };
  /** Trusted stores must honor the projected SDK owner/tenant scope. */
  push?: {
    store: PushNotificationStore;
    sender: PushNotificationSender;
    /** Without this hook, the application retains push cleanup ownership. */
    close?: () => Promise<PushCloseResult>;
  };
  /** Private diagnostics only. Do not log raw requests or credentials. */
  onError?: (event: { taskId: string; error: unknown }) => void | Promise<void>;
  /** Anonymous local profile: every caller belongs to this one sharing domain. */
  sharingDomain: string;
  publicBaseUrl: string;
  name?: string;
  taskStore?: TaskStore;
  shutdownTimeoutMs?: number;
}
export type CreateBridgeOptions = BridgeOptions &
  (
    | {
        runner: LettaTurnRunner;
        client?: never;
        agentId?: never;
        sessionOptions?: never;
        beforeTurn?: never;
      }
    | {
        runner?: never;
        client: LettaAgentClient;
        agentId: string;
        sessionOptions: SessionPolicy["sessionOptions"];
        beforeTurn?: SessionPolicy["beforeTurn"];
      }
  );

/** No agents, sockets, hooks or global mods are created by importing this module. */
export function createBridge(options: CreateBridgeOptions) {
  if (!options.auth) assertLoopbackUrl(options.publicBaseUrl);
  else {
    const url = new URL(options.publicBaseUrl);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("Authenticated bridge requires an HTTP(S) origin");
  }
  if (!options.sharingDomain.trim())
    throw new Error("An explicit sharing domain is required");
  const runner =
    options.runner ??
    new AgentSdkTurnRunner(options.client!, options.agentId!, {
      sharingDomain: options.sharingDomain,
      sessionOptions: options.sessionOptions!,
      beforeTurn: options.beforeTurn,
    });
  const executor = new LettaAgentExecutor(
    runner,
    options.shutdownTimeoutMs,
    options.onError,
  );
  const card = createAgentCard(options.publicBaseUrl, options.name);
  card.capabilities!.pushNotifications = !!options.push;
  if (options.security) {
    card.securitySchemes = structuredClone(options.security.securitySchemes);
    card.securityRequirements = structuredClone(
      options.security.securityRequirements,
    );
  }
  // Custom stores are trusted application adapters and must preserve owner scoping.
  const taskStore = options.taskStore ?? new InMemoryTaskStore();
  const sdk = new DefaultRequestHandler(
    card,
    taskStore,
    executor,
    undefined,
    options.push?.store,
    options.push?.sender,
  );
  const policy = new RequestPolicy(options.sharingDomain, options.auth);
  const requestHandler = new BridgeRequestHandler(
    sdk,
    taskStore,
    executor,
    policy,
    !!options.push,
    options.onError,
  );
  let closing: Promise<BridgeCloseResult> | undefined;
  return {
    card,
    executor,
    requestHandler,
    transport: options.transport,
    authenticated: !!options.auth,
    close() {
      if (closing) return closing;
      const turns = executor.close();
      closing = Promise.all([
        turns,
        closePush(
          options.push?.close?.bind(options.push),
          options.shutdownTimeoutMs ?? 5000,
        ),
      ]).then(([result, push]) => ({
        ...result,
        ...(push ? { push } : {}),
        complete: result.complete && (push?.complete ?? true),
      }));
      return closing;
    },
  };
}
export type Bridge = ReturnType<typeof createBridge>;

async function closePush(
  close: (() => Promise<PushCloseResult>) | undefined,
  timeoutMs: number,
): Promise<PushCloseResult | undefined> {
  if (!close) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(close)
        .catch(() => ({ complete: false })),
      new Promise<PushCloseResult>((resolve) => {
        timer = setTimeout(() => resolve({ complete: false }), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type Params<K extends Exclude<keyof A2ARequestHandler, "getAgentCard">> =
  Parameters<A2ARequestHandler[K]>[0];

/** Authorization precedes every official handler call, including direct calls.
 * The SDK instance is private so its internal card lookups need not bypass policy. */
class BridgeRequestHandler implements A2ARequestHandler {
  private readonly submissions = new Set<string>();
  private readonly messages = new Set<string>();
  private readonly cancellations = new Set<string>();
  constructor(
    private readonly sdk: DefaultRequestHandler,
    private readonly store: TaskStore,
    private readonly executor: LettaAgentExecutor,
    private readonly policy: RequestPolicy,
    private readonly pushEnabled: boolean,
    private readonly onError?: BridgeOptions["onError"],
  ) {}

  async getAgentCard(context?: ServerCallContext) {
    await this.policy.context("discover", {}, context);
    return this.sdk.getAgentCard();
  }
  async getAuthenticatedExtendedAgentCard(
    p: Params<"getAuthenticatedExtendedAgentCard">,
    c: ServerCallContext,
  ) {
    return this.sdk.getAuthenticatedExtendedAgentCard(
      p,
      await this.policy.context("getAuthenticatedExtendedAgentCard", p, c),
    );
  }
  async getTask(p: Params<"getTask">, c: ServerCallContext) {
    const scoped = await this.policy.context("getTask", p, c);
    validateHistory(p);
    return this.sdk.getTask(p, scoped);
  }
  async listTasks(p: Params<"listTasks">, c: ServerCallContext) {
    const scoped = await this.policy.context("listTasks", p, c);
    validateHistory(p);
    if (p.pageSize !== undefined && !Number.isInteger(p.pageSize))
      throw new RequestMalformedError("pageSize must be an integer");
    return this.sdk.listTasks(p, scoped);
  }
  async cancelTask(p: Params<"cancelTask">, c: ServerCallContext) {
    const scoped = await this.policy.context("cancelTask", p, c);
    // Establish ownership before touching task-global execution reservations.
    const task = await this.store.load(p.id, scoped);
    if (!task) throw new TaskNotFoundError();
    if (
      this.cancellations.has(p.id) ||
      (this.submissions.has(p.id) && !this.executor.isActive(p.id))
    )
      throw new UnsupportedOperationError("Task operation is already pending");
    this.cancellations.add(p.id);
    try {
      // Never let the SDK's missing-bus fallback assert remote cancellation after restart.
      if (
        task.status &&
        [
          TaskState.TASK_STATE_WORKING,
          TaskState.TASK_STATE_SUBMITTED,
          TaskState.TASK_STATE_INPUT_REQUIRED,
          TaskState.TASK_STATE_AUTH_REQUIRED,
        ].includes(task.status.state) &&
        !this.executor.isActive(p.id) &&
        !this.executor.canResume(p.id)
      )
        throw new UnsupportedOperationError(
          "Task execution requires reconciliation",
        );
      return await this.sdk.cancelTask(p, scoped);
    } finally {
      this.cancellations.delete(p.id);
    }
  }
  async *resubscribe(p: Params<"resubscribe">, c: ServerCallContext) {
    yield* this.sdk.resubscribe(
      p,
      await this.policy.context("resubscribe", p, c),
    );
  }
  async createTaskPushNotificationConfig(
    p: Params<"createTaskPushNotificationConfig">,
    c: ServerCallContext,
  ) {
    return this.sdk.createTaskPushNotificationConfig(
      p,
      await this.policy.context("createTaskPushNotificationConfig", p, c),
    );
  }
  async getTaskPushNotificationConfig(
    p: Params<"getTaskPushNotificationConfig">,
    c: ServerCallContext,
  ) {
    return this.sdk.getTaskPushNotificationConfig(
      p,
      await this.policy.context("getTaskPushNotificationConfig", p, c),
    );
  }
  async listTaskPushNotificationConfigs(
    p: Params<"listTaskPushNotificationConfigs">,
    c: ServerCallContext,
  ) {
    return this.sdk.listTaskPushNotificationConfigs(
      p,
      await this.policy.context("listTaskPushNotificationConfigs", p, c),
    );
  }
  async deleteTaskPushNotificationConfig(
    p: Params<"deleteTaskPushNotificationConfig">,
    c: ServerCallContext,
  ) {
    return this.sdk.deleteTaskPushNotificationConfig(
      p,
      await this.policy.context("deleteTaskPushNotificationConfig", p, c),
    );
  }
  async sendMessage(p: SendMessageRequest, c: ServerCallContext) {
    const scoped = await this.policy.context("sendMessage", p, c);
    if (p.configuration?.taskPushNotificationConfig)
      await this.policy.context(
        "createTaskPushNotificationConfig",
        p.configuration.taskPushNotificationConfig,
        c,
      );
    const release = await this.reserve(p, scoped);
    try {
      return await this.sdk.sendMessage(p, scoped);
    } finally {
      release();
    }
  }
  async *sendMessageStream(p: SendMessageRequest, c: ServerCallContext) {
    const scoped = await this.policy.context("sendMessageStream", p, c);
    if (p.configuration?.taskPushNotificationConfig)
      await this.policy.context(
        "createTaskPushNotificationConfig",
        p.configuration.taskPushNotificationConfig,
        c,
      );
    const release = await this.reserve(p, scoped);
    const stream = this.sdk.sendMessageStream(p, scoped);
    let done = false;
    try {
      while (true) {
        const next = await stream.next();
        if (next.done) {
          done = true;
          break;
        }
        yield next.value;
      }
    } finally {
      if (done) release();
      else {
        // Returning from the public iterator is a local disconnect, not task
        // cancellation. Keep the official ResultManager consuming/persisting.
        void (async () => {
          try {
            for await (const _event of stream) {
              /* SDK owns persistence. */
            }
          } catch (error) {
            try {
              void Promise.resolve(
                this.onError?.({ taskId: p.message?.taskId ?? "", error }),
              ).catch(() => undefined);
            } catch {
              /* Private diagnostics only. */
            }
          } finally {
            release();
          }
        })();
      }
    }
  }
  private async reserve(
    p: SendMessageRequest,
    c: ServerCallContext,
  ): Promise<() => void> {
    validateHistory(p.configuration ?? {});
    if (!p.message?.messageId)
      throw new RequestMalformedError("message.messageId is required");
    const modes = p.configuration?.acceptedOutputModes;
    if (modes?.length && !modes.includes("text/plain"))
      throw new ContentTypeNotSupportedError(
        "Only text/plain output is supported",
      );
    try {
      if (!readText(p.message).trim()) throw new Error();
    } catch {
      throw new ContentTypeNotSupportedError(
        "Only nonempty text/plain input is supported",
      );
    }
    if (p.configuration?.taskPushNotificationConfig && !this.pushEnabled)
      throw new PushNotificationNotSupportedError();
    const taskId = p.message.taskId;
    const task = taskId ? await this.store.load(taskId, c) : undefined;
    if (taskId && !task) throw new TaskNotFoundError();
    const key = JSON.stringify([
      c.user?.userName,
      c.tenant,
      p.message.messageId,
    ]);
    if (this.messages.has(key))
      throw new UnsupportedOperationError("Duplicate message submission");
    if (
      taskId &&
      (this.submissions.has(taskId) ||
        this.cancellations.has(taskId) ||
        this.executor.isActive(taskId))
    )
      throw new UnsupportedOperationError("Task execution is already active");
    // Recheck and reserve synchronously after ownership lookup, before SDK mutation.
    this.messages.add(key);
    if (taskId) this.submissions.add(taskId);
    try {
      if (taskId && task) {
        if (
          !this.executor.canResume(taskId) ||
          !task.status ||
          ![
            TaskState.TASK_STATE_INPUT_REQUIRED,
            TaskState.TASK_STATE_AUTH_REQUIRED,
          ].includes(task.status.state)
        )
          throw new UnsupportedOperationError(
            "Only safely interrupted tasks can continue",
          );
        if (p.message.contextId && p.message.contextId !== task.contextId)
          throw new RequestMalformedError("contextId mismatch");
      }
    } catch (error) {
      this.messages.delete(key);
      if (taskId) this.submissions.delete(taskId);
      throw error;
    }
    return () => {
      if (taskId) this.submissions.delete(taskId);
    };
  }
}

/** Mount the same guarded SDK transport at an application-owned path. */
export function createBridgeRouter(
  bridge: Bridge,
  options: { legacyCompat?: { enabled: boolean } } = {},
) {
  if (bridge.authenticated && !bridge.transport)
    throw new Error(
      "Authenticated listener requires trusted transport userBuilder/middleware composition",
    );
  const app = express.Router();
  for (const middleware of bridge.transport?.middleware ?? [])
    app.use(middleware);
  const userBuilder =
    bridge.transport?.userBuilder ?? UserBuilder.noAuthentication;
  app.use(`/${AGENT_CARD_PATH}`, async (req, res, next) => {
    try {
      const context = new ServerCallContext({
        user: await userBuilder(req),
        requestedVersion: "1.0",
      });
      const card = await bridge.requestHandler.getAgentCard(context);
      if (bridge.authenticated) {
        // SDK agentCardHandler defaults to public max-age=3600. Protected cards
        // instead use the official serializer without shared caching or 304s.
        res.setHeader("Cache-Control", "private, no-store");
        res.json(AgentCard.toJSON(card));
        return;
      }
      return agentCardHandler({ agentCardProvider: async () => card })(
        req,
        res,
        next,
      );
    } catch (error) {
      if (error instanceof BridgeAccessError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "Discovery unavailable" });
    }
  });
  const handler = bridge.requestHandler;
  // SDK Express calls getAgentCard() without context to negotiate versions before
  // RPC dispatch. This transport-local provider is NOT mounted for discovery;
  // all actual RPC operations still enter the guarded public handler.
  const rpcHandler: A2ARequestHandler = {
    getAgentCard: async () => bridge.card,
    getAuthenticatedExtendedAgentCard:
      handler.getAuthenticatedExtendedAgentCard.bind(handler),
    sendMessage: handler.sendMessage.bind(handler),
    sendMessageStream: handler.sendMessageStream.bind(handler),
    getTask: handler.getTask.bind(handler),
    listTasks: handler.listTasks.bind(handler),
    cancelTask: handler.cancelTask.bind(handler),
    resubscribe: handler.resubscribe.bind(handler),
    createTaskPushNotificationConfig:
      handler.createTaskPushNotificationConfig.bind(handler),
    getTaskPushNotificationConfig:
      handler.getTaskPushNotificationConfig.bind(handler),
    listTaskPushNotificationConfigs:
      handler.listTaskPushNotificationConfigs.bind(handler),
    deleteTaskPushNotificationConfig:
      handler.deleteTaskPushNotificationConfig.bind(handler),
  };
  app.use(
    "/",
    jsonRpcHandler({ requestHandler: rpcHandler, userBuilder, ...options }),
  );
  return app;
}

/** The convenience listener intentionally offers no non-loopback host option. */
export async function listenLoopback(
  bridge: Bridge,
  options: { port?: number } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(createBridgeRouter(bridge));
  const server = app.listen(options.port ?? 0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected TCP listener");
  const url = `http://127.0.0.1:${address.port}`;
  bridge.card.supportedInterfaces[0]!.url = `${url}/`;
  let closing: ReturnType<Bridge["close"]> | undefined;
  return {
    url,
    close() {
      if (closing) return closing;
      // Stop accepting immediately; bound turn cleanup, then terminate HTTP streams.
      const closed = new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      closing = bridge.close().then(async (result) => {
        server.closeAllConnections();
        await closed;
        return result;
      });
      return closing;
    },
  };
}
function assertLoopbackUrl(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Anonymous bridge requires a loopback HTTP origin");
  }
}
function createAgentCard(
  baseUrl: string,
  name = "Letta Agent SDK bridge",
): AgentCard {
  return {
    name,
    description:
      "A persistent Letta agent through the official A2A and Letta Agent SDKs.",
    supportedInterfaces: [
      {
        url: `${baseUrl.replace(/\/$/, "")}/`,
        protocolBinding: "JSONRPC",
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: "",
      },
    ],
    provider: { organization: "Letta A2A", url: baseUrl },
    version: "0.1.0",
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "text-assistance",
        name: "Text assistance",
        description: "Text requests with dedicated conversation continuity.",
        tags: ["letta"],
        examples: [],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
        securityRequirements: [],
      },
    ],
    documentationUrl: "",
    signatures: [],
  };
}
