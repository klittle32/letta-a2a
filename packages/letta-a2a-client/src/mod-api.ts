export interface LettaModApi {
  capabilities: { tools: boolean };
  diagnostics: {
    report(input: { message: string; severity?: "error" | "warning" }): void;
  };
  tools: {
    register(tool: LettaModTool): () => void;
  };
}

export interface LettaModToolContext {
  args: Record<string, unknown>;
  signal: AbortSignal;
  sessionId: string | null;
  agent: { id: string | null };
  conversation: { id: string | null };
}

export interface LettaModTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  parallelSafe: boolean;
  run(context: LettaModToolContext): Promise<unknown>;
}
