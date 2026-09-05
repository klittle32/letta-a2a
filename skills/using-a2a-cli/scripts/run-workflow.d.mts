export type CommandRunner = (arguments_: string[]) => Promise<unknown>;

export interface WorkflowResult {
  outcome: "message" | "task";
  state: string;
  contextId?: string;
  continuationUnavailable?: true;
  taskId?: string;
  text?: string;
  missingText?: true;
  nonTextParts?: Array<{ location: string; kind: string }>;
  cancelAttempted?: true;
  cancelSucceeded?: boolean;
}

export function extractResult(envelope: unknown): WorkflowResult;
export function validateAgentCard(
  card: unknown,
  options?: { expectedGatewayUrl?: string; expectedTokenUrl?: string },
): Record<string, unknown>;
export function runWorkflow(options: {
  text: string;
  contextId?: string;
  runner?: CommandRunner;
  expectedGatewayUrl?: string;
  expectedTokenUrl?: string;
  sleep?: (milliseconds: number) => Promise<void>;
  clock?: () => number;
  timeoutMs?: number;
}): Promise<WorkflowResult>;
export function launcherRunner(
  launcher?: string,
  options?: {
    timeoutMs?: number;
    stdoutLimit?: number;
    stderrLimit?: number;
  },
): CommandRunner;
