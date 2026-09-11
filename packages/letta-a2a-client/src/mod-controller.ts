import type { LettaModToolContext } from "./mod-api.js";
import {
  runA2ATool,
  type A2AToolClient,
  type A2AToolName,
} from "./tool-operations.js";

export class A2AModController {
  constructor(private readonly client: A2AToolClient) {}

  async run(
    name: A2AToolName,
    context: LettaModToolContext,
  ): Promise<string | { status: "error"; content: string }> {
    const result = await runA2ATool(name, context.args, {
      client: this.client,
      getScope: () => ({
        agentId: context.agent.id,
        conversationId: context.conversation.id,
      }),
      signal: context.signal,
    });
    return result.isError
      ? { status: "error", content: result.content }
      : result.content;
  }

  targets(): string[] {
    return this.client.targets();
  }
}
