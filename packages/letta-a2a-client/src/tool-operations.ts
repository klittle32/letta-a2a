import { TaskState, type Message, type Part, type Task } from "@a2a-js/sdk";
import { A2AInvocationError } from "./a2a-invoker.js";
import type { A2AToolService } from "./tool-service.js";

export type A2AToolName = "a2a_invoke" | "a2a_task";
export type A2AToolClient = Pick<
  A2AToolService,
  "invoke" | "task" | "targets" | "drain"
>;
export interface A2AScope {
  agentId?: string | null;
  conversationId?: string | null;
}
export type A2AScopeGetter = () => A2AScope | null | undefined;
export interface A2AToolResult {
  content: string;
  isError: boolean;
}
export interface A2AToolRunOptions {
  client: A2AToolClient;
  getScope: A2AScopeGetter;
  signal: AbortSignal;
}

const stringSchema = { type: "string", minLength: 1 };
export const A2A_TOOL_DEFINITIONS = [
  {
    name: "a2a_invoke",
    description:
      "Send a message to a configured remote A2A agent. Reuses this conversation's remote context; use task_id for same-task followup. Working or interrupted results can be inspected with a2a_task.",
    parameters: {
      type: "object",
      properties: {
        target: stringSchema,
        message: stringSchema,
        context_id: stringSchema,
        task_id: stringSchema,
        new_context: { type: "boolean" },
      },
      required: ["target", "message"],
      additionalProperties: false,
    },
    requiresApproval: true,
    parallelSafe: false,
  },
  {
    name: "a2a_task",
    description:
      "Read or request cancellation of a known remote A2A task. Cancellation is confirmed only when the returned state is canceled.",
    parameters: {
      type: "object",
      properties: {
        target: stringSchema,
        task_id: stringSchema,
        action: { type: "string", enum: ["get", "cancel"] },
      },
      required: ["target", "task_id", "action"],
      additionalProperties: false,
    },
    requiresApproval: true,
    parallelSafe: false,
  },
] satisfies Array<{
  name: A2AToolName;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  parallelSafe: boolean;
}>;

/** Snapshot discovery from local configuration only; never contacts a peer. */
export function getA2AToolDefinitions(client: Pick<A2AToolClient, "targets">) {
  const targets = [...client.targets()].sort();
  return A2A_TOOL_DEFINITIONS.map((definition) => ({
    ...definition,
    description: `${definition.description} Configured targets: ${targets.join(", ") || "none configured"}.`,
    parameters: {
      ...definition.parameters,
      properties: {
        ...definition.parameters.properties,
        target: {
          ...stringSchema,
          ...(targets.length ? { enum: targets } : {}),
        },
      },
    },
  }));
}

class ArgumentError extends Error {}
function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new ArgumentError(`${name} must be a non-empty string`);
  return value;
}
function optionalString(
  args: Record<string, unknown>,
  name: string,
): string | undefined {
  return Object.hasOwn(args, name)
    ? requiredString(args[name], name)
    : undefined;
}
export function resolveA2AScope(getScope: A2AScopeGetter): string {
  const scope = getScope();
  const agent = requiredString(
    scope?.agentId,
    "Trusted agentId (session must be ready)",
  );
  const conversation = requiredString(
    scope?.conversationId,
    "Trusted conversationId (session must be ready)",
  );
  if (agent.includes("/") || conversation.includes("/"))
    throw new ArgumentError("Trusted scope IDs must not contain slashes");
  return `${agent}/${conversation}`;
}
export function readA2AArguments(name: A2AToolName, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ArgumentError("Arguments must be an object");
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new ArgumentError("Arguments must be a plain object");
  const args = value as Record<string, unknown>;
  const allowed =
    name === "a2a_invoke"
      ? ["target", "message", "context_id", "task_id", "new_context"]
      : ["target", "task_id", "action"];
  if (
    Reflect.ownKeys(args).some(
      (key) => typeof key !== "string" || !allowed.includes(key),
    )
  )
    throw new ArgumentError(
      "Unknown A2A argument; scope and identity are host-owned",
    );
  const target = requiredString(args.target, "target");
  if (name === "a2a_task") {
    const taskId = requiredString(args.task_id, "task_id");
    if (args.action !== "get" && args.action !== "cancel")
      throw new ArgumentError("action must be get or cancel");
    const action: "get" | "cancel" = args.action;
    return { kind: "task" as const, target, taskId, action };
  }
  const message = requiredString(args.message, "message");
  const contextId = optionalString(args, "context_id");
  const taskId = optionalString(args, "task_id");
  if (
    Object.hasOwn(args, "new_context") &&
    typeof args.new_context !== "boolean"
  )
    throw new ArgumentError("new_context must be a boolean");
  const newContext = args.new_context as boolean | undefined;
  if (newContext && (contextId || taskId))
    throw new ArgumentError(
      "new_context cannot be combined with context_id or task_id",
    );
  return {
    kind: "invoke" as const,
    target,
    message,
    contextId,
    taskId,
    newContext,
  };
}

const states: Record<number, string> = {
  [TaskState.TASK_STATE_UNSPECIFIED]: "unspecified",
  [TaskState.TASK_STATE_SUBMITTED]: "submitted",
  [TaskState.TASK_STATE_WORKING]: "working",
  [TaskState.TASK_STATE_COMPLETED]: "completed",
  [TaskState.TASK_STATE_FAILED]: "failed",
  [TaskState.TASK_STATE_CANCELED]: "canceled",
  [TaskState.TASK_STATE_INPUT_REQUIRED]: "input-required",
  [TaskState.TASK_STATE_REJECTED]: "rejected",
  [TaskState.TASK_STATE_AUTH_REQUIRED]: "auth-required",
};
const stateName = (task: Task) => states[task.status?.state ?? 0] ?? "unknown";
const failed = (task: Task) =>
  ["failed", "canceled", "rejected"].includes(stateName(task));
const clip = (text: string, limit: number) =>
  text.length <= limit
    ? text
    : `${text.slice(0, limit)}…[truncated ${text.length - limit} chars]`;

function dataSummary(value: unknown) {
  if (value === null) return { type: "null" };
  if (Array.isArray(value))
    return { type: "array", items: value.length, valuesOmitted: true };
  if (typeof value === "object")
    return {
      type: "object",
      properties: Object.keys(value).length,
      valuesOmitted: true,
    };
  return {
    type: typeof value,
    ...(typeof value === "string" ? { characters: value.length } : {}),
    valueOmitted: true,
  };
}
type JSONPreview =
  | null
  | boolean
  | number
  | string
  | JSONPreview[]
  | { [key: string]: JSONPreview };

/** Conservative data preview: scalar strings may contain credentials or private
 * reasoning, so only numeric/boolean/null values and safe structural keys pass.
 * This is not a general secret detector. Unclassified strings stay omitted.
 */
function dataPreview(value: unknown, limit: number) {
  let nodes = 0;
  function visit(item: unknown, depth: number): JSONPreview {
    if (++nodes > 40) return "[omitted: preview node budget]";
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number")
      return Number.isFinite(item) ? item : "[omitted: non-JSON number]";
    if (typeof item === "string") return "[omitted: unclassified string value]";
    if (depth >= 3) return "[omitted: preview depth limit]";
    if (Array.isArray(item)) {
      const preview = item.slice(0, 8).map((entry) => visit(entry, depth + 1));
      if (item.length > 8)
        preview.push(`[omitted: ${item.length - 8} array items]`);
      return preview;
    }
    if (
      item &&
      typeof item === "object" &&
      (Object.getPrototypeOf(item) === Object.prototype ||
        Object.getPrototypeOf(item) === null)
    ) {
      const entries = Object.entries(item);
      const preview: { [key: string]: JSONPreview } = {};
      let omitted = Math.max(0, entries.length - 8);
      for (const [key, entry] of entries.slice(0, 8)) {
        if (
          ["__proto__", "constructor", "prototype"].includes(key) ||
          !/^[A-Za-z_][A-Za-z0-9_-]{0,47}$/.test(key) ||
          /secret|password|token|auth|credential|cookie|header|metadata|reason|thought|base64|raw|private|key/i.test(
            key,
          )
        ) {
          omitted++;
          continue;
        }
        preview[key] = visit(entry, depth + 1);
      }
      if (omitted) preview.$omittedProperties = omitted;
      return preview;
    }
    return "[omitted: non-JSON value]";
  }
  const preview = visit(value, 0);
  return JSON.stringify(preview).length <= Math.min(limit, 1000)
    ? { preview }
    : { previewOmitted: "JSON preview exceeds size budget" };
}

function fileUrl(value: string, limit: number) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      return "[URL omitted: non-HTTP scheme]";
    url.username = "";
    url.password = "";
    return clip(url.toString(), limit);
  } catch {
    return "[URL omitted: invalid URL]";
  }
}
function previewParts(parts: Part[], limit: number, count: number) {
  return {
    parts: parts.slice(0, count).map((part) => {
      const common = {
        filename: clip(part.filename, limit),
        mediaType: clip(part.mediaType, limit),
      };
      const content = part.content;
      switch (content?.$case) {
        case "text":
          return { type: "text", text: clip(content.value, limit) };
        case "data":
          return {
            type: "data",
            ...common,
            summary: dataSummary(content.value),
            ...dataPreview(content.value, limit),
          };
        case "raw":
          return {
            type: "file",
            ...common,
            byteCount: content.value.byteLength,
            bytesOmitted: true,
          };
        case "url":
          return {
            type: "file",
            ...common,
            url: fileUrl(content.value, limit),
          };
        default:
          return { type: "unknown", contentOmitted: true };
      }
    }),
    ...(parts.length > count ? { omittedParts: parts.length - count } : {}),
  };
}
function previewMessage(message: Message, limit: number, count: number) {
  return {
    messageId: clip(message.messageId, limit),
    text: clip(
      message.parts
        .slice(0, count)
        .flatMap((part) =>
          part.content?.$case === "text"
            ? [part.content.value.slice(0, limit + 1)]
            : [],
        )
        .join("\n"),
      limit,
    ),
    ...previewParts(message.parts, limit, count),
  };
}
function projection(
  target: string,
  result: Task | Message,
  limit: number,
  count: number,
) {
  if (!("id" in result))
    return {
      target: clip(target, limit),
      status: "message",
      taskId: clip(result.taskId, limit),
      contextId: clip(result.contextId, limit),
      ...previewMessage(result, limit, count),
    };
  return {
    target: clip(target, limit),
    status: stateName(result),
    taskId: clip(result.id, limit),
    contextId: clip(result.contextId, limit),
    text: clip(
      result.artifacts
        .slice(0, count)
        .flatMap((artifact) =>
          artifact.parts
            .slice(0, count)
            .flatMap((part) =>
              part.content?.$case === "text"
                ? [part.content.value.slice(0, limit + 1)]
                : [],
            ),
        )
        .join("\n"),
      limit,
    ),
    ...(result.status?.message
      ? { statusMessage: previewMessage(result.status.message, limit, count) }
      : {}),
    artifacts: result.artifacts.slice(0, count).map((artifact) => ({
      artifactId: clip(artifact.artifactId, limit),
      name: clip(artifact.name, limit),
      ...previewParts(artifact.parts, limit, count),
    })),
    ...(result.artifacts.length > count
      ? { omittedArtifacts: result.artifacts.length - count }
      : {}),
    ...(result.history.length
      ? { omittedHistoryMessages: result.history.length }
      : {}),
  };
}

/** Model-only projection. Never mutates the canonical SDK response. */
export function projectA2AResult(
  target: string,
  result: Task | Message,
): A2AToolResult {
  return {
    content: boundedProjection(target, result),
    isError: "id" in result && failed(result),
  };
}
function boundedProjection(
  target: string,
  result?: Task | Message,
  extra: Record<string, unknown> = {},
): string {
  for (const [limit, count] of [
    [2000, 12],
    [800, 8],
    [300, 4],
    [100, 2],
  ] as const) {
    const content = JSON.stringify({
      ...(result
        ? projection(target, result, limit, count)
        : { target: clip(target, limit), status: "error" }),
      ...Object.fromEntries(
        Object.entries(extra).map(([key, value]) => [
          key,
          typeof value === "string" ? clip(value, limit) : value,
        ]),
      ),
    });
    if (content.length <= 16_000) return content;
  }
  // Extra fields are strictly bounded below; this is only a defensive fallback.
  return JSON.stringify({
    target: clip(target, 100),
    status: "error",
    contentOmitted: true,
    error: "Projection exceeded output budget",
  });
}
export async function runA2ATool(
  name: A2AToolName,
  args: unknown,
  options: A2AToolRunOptions,
): Promise<A2AToolResult> {
  let target = "";
  let action: "get" | "cancel" | undefined;
  let readback: { taskId?: string; contextId?: string } = {};
  try {
    const input = readA2AArguments(name, args);
    target = input.target;
    readback = {
      taskId: input.taskId,
      contextId: input.kind === "invoke" ? input.contextId : undefined,
    };
    const localScope = resolveA2AScope(options.getScope);
    if (options.signal.aborted)
      throw new ArgumentError(
        "A2A tool owner is closed or canceled; no new submission attempted",
      );
    if (input.kind === "task") {
      action = input.action;
      const result = await options.client.task({
        target,
        taskId: input.taskId,
        action,
        localScope,
        signal: options.signal,
      });
      return {
        content: boundedProjection(
          target,
          result,
          action === "cancel"
            ? {
                cancellation:
                  stateName(result) === "canceled"
                    ? "confirmed"
                    : "requested-not-confirmed",
              }
            : {},
        ),
        isError: failed(result),
      };
    }
    const result = await options.client.invoke({
      target,
      message: input.message,
      contextId: input.contextId,
      taskId: input.taskId,
      newContext: input.newContext,
      localScope,
      signal: options.signal,
    });
    return projectA2AResult(target, result);
  } catch (error) {
    if (error instanceof A2AInvocationError) {
      return {
        isError: true,
        content: boundedProjection(target, error.task, {
          ...(!error.task ? readback : {}),
          error: clip(error.message, 2000),
          submissionAttempted: error.submissionAttempted,
          ...(error.messageId ? { messageId: clip(error.messageId, 300) } : {}),
          ...(error.cancellation
            ? {
                cancellation:
                  stateName(error.cancellation) === "canceled"
                    ? "confirmed"
                    : "requested-not-confirmed",
                cancellationTaskId: clip(error.cancellation.id, 300),
                cancellationContextId: clip(error.cancellation.contextId, 300),
                cancellationStatus: stateName(error.cancellation),
              }
            : { cancellation: "not-confirmed" }),
        }),
      };
    }
    return {
      isError: true,
      content: boundedProjection(target, undefined, {
        ...readback,
        error:
          error instanceof ArgumentError
            ? clip(error.message, 2000)
            : "A2A operation failed; inspect the known task before retrying",
        ...(action === "cancel" ? { cancellation: "not-confirmed" } : {}),
      }),
    };
  }
}
