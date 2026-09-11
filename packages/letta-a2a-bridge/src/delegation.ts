export const DELEGATION_HOP_HEADER = "x-letta-a2a-hop";

/** Application policy, not an A2A protocol field or a model-controlled argument. */
export interface DelegationInput {
  text: string;
  returnImmediately: boolean;
  /** Derived from a verified caller identity/role, never request metadata. */
  delegatedCaller: boolean;
  hopHeader?: string;
  maximumHops?: number;
}

export function delegationPolicy(input: DelegationInput) {
  const maximumHops = input.maximumHops ?? 1;
  if (
    !Number.isSafeInteger(maximumHops) ||
    maximumHops < 1 ||
    maximumHops > 32
  ) {
    throw new Error("maximumHops must be an integer between 1 and 32");
  }
  let hop = 0;
  if (input.delegatedCaller) {
    if (!input.hopHeader || !/^[1-9]\d*$/.test(input.hopHeader)) {
      throw new Error(
        "Delegated requests require a positive canonical hop header",
      );
    }
    hop = Number(input.hopHeader);
    if (!Number.isSafeInteger(hop) || hop > maximumHops)
      throw new Error("Delegation hop limit exceeded");
  } else if (input.hopHeader !== undefined) {
    throw new Error(
      "Only a trusted delegate can supply a delegation hop header",
    );
  }
  const explicit = /\ba2a_invoke\b/i.test(input.text);
  if (explicit && !input.returnImmediately) {
    throw new Error("Delegation requires configuration.returnImmediately=true");
  }
  return {
    hop,
    allowDelegation: explicit && hop < maximumHops,
    outboundHeaders: { [DELEGATION_HOP_HEADER]: String(hop + 1) },
  };
}
