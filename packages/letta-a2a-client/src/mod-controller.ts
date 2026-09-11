import type { A2AClientConfig } from "./config.js";
import type { LettaModToolContext } from "./mod-api.js";
import type { A2AToolService } from "./tool-service.js";

export class A2AModController {
  constructor(
    private readonly config: A2AClientConfig,
    private readonly service: A2AToolService,
  ) {}

  async run(context: LettaModToolContext): Promise<unknown> {
    const input = readArguments(context.args);
    const conversationId = context.conversation.id ?? context.sessionId;
    if (!conversationId) {
      return toolError("The active Letta conversation has no stable ID");
    }

    try {
      const result = await this.service.invoke({
        ...input,
        localScope: `${context.agent.id ?? "unbound-agent"}/${conversationId}`,
        signal: context.signal,
      });
      const output = JSON.stringify({ target: input.target, ...result });
      return result.ok ? output : toolError(output);
    } catch (error) {
      if (context.signal.aborted) throw error;
      return toolError(error instanceof Error ? error.message : String(error));
    }
  }

  targets(): string[] {
    return Object.keys(this.config.routes).sort();
  }
}

export function readArguments(args: Record<string, unknown>): {
  target: string;
  message: string;
  contextId?: string;
  newContext?: boolean;
} {
  const target = requiredString(args.target, "target");
  const message = requiredString(args.message, "message");
  const contextId = optionalString(args.context_id, "context_id");
  const newContext = optionalBoolean(args.new_context, "new_context");
  if (contextId && newContext) {
    throw new Error("context_id and new_context cannot be used together");
  }
  return { target, message, contextId, newContext };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function toolError(content: string) {
  return { status: "error" as const, content };
}
