export function extractA2AHop(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0;
  const lab = (metadata as Record<string, unknown>).lettaA2aLab;
  if (!lab || typeof lab !== "object") return 0;
  const hop = (lab as Record<string, unknown>).hop;
  return typeof hop === "number" && Number.isInteger(hop) && hop >= 0 ? hop : 0;
}

export function shouldExposeDelegationTool(
  text: string,
  hop: number,
  maximumHops: number,
): boolean {
  return hop < maximumHops && /\ba2a_invoke\b/i.test(text);
}

export function assertDelegationRequestIsAsync(
  text: string,
  returnImmediately: boolean,
): void {
  if (/\ba2a_invoke\b/i.test(text) && !returnImmediately) {
    throw new Error(
      "Bidirectional delegation through one LiteLLM gateway requires configuration.returnImmediately=true; poll the returned task with GetTask.",
    );
  }
}
