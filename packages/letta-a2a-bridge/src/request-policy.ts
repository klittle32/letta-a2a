import { A2AError, RequestMalformedError } from "@a2a-js/sdk/errors";
import { ServerCallContext, type A2ARequestHandler } from "@a2a-js/sdk/server";

/** Application-verified identity. Never project this from unverified headers or metadata. */
export interface TrustedCaller {
  readonly issuer: string;
  readonly subject: string;
  readonly tenant: string;
  /** Optional application-verified delegation context; never part of the owner key. */
  readonly delegation?: Readonly<{ hop: number; allowDelegation: boolean }>;
}
export type BridgeOperation =
  | Exclude<keyof A2ARequestHandler, "getAgentCard">
  | "discover";
export interface BridgeAuthorization {
  /** JWT/signature validation belongs to the application's transport boundary. */
  projectCaller(
    context: ServerCallContext,
  ): TrustedCaller | undefined | Promise<TrustedCaller | undefined>;
  authorize(request: {
    readonly caller: TrustedCaller;
    readonly operation: BridgeOperation;
    /** This request's original verified transport context. Read current token claims here;
     * never cache authorization scopes globally by principal identity. */
    readonly context: ServerCallContext;
    /** Untrusted protocol parameters, provided for resource/action decisions only. */
    readonly params: unknown;
  }): boolean | Promise<boolean>;
}
export class BridgeAccessError extends A2AError {
  constructor(readonly statusCode: 401 | 403) {
    super(
      statusCode === 401 ? "Authentication required" : "Operation forbidden",
    );
  }
}
const callers = new WeakMap<ServerCallContext, TrustedCaller>();
export function trustedCaller(
  context: ServerCallContext,
): TrustedCaller | undefined {
  return callers.get(context);
}

/** Copies only verified identity into the official owner/tenant store seams. */
export class RequestPolicy {
  constructor(
    private readonly binding: string,
    private readonly auth?: BridgeAuthorization,
  ) {}
  async context(
    operation: BridgeOperation,
    params: { tenant?: string },
    input?: ServerCallContext,
  ): Promise<ServerCallContext> {
    if (!input) {
      if (this.auth) throw new BridgeAccessError(401);
      input = new ServerCallContext();
    }
    let caller: TrustedCaller | undefined;
    if (this.auth) {
      let projected: TrustedCaller | undefined;
      try {
        projected = await this.auth.projectCaller(input);
      } catch {
        throw new BridgeAccessError(401);
      }
      if (
        !projected ||
        !projected.issuer?.trim() ||
        !projected.subject?.trim() ||
        typeof projected.tenant !== "string"
      )
        throw new BridgeAccessError(401);
      const delegation = projected.delegation;
      if (
        delegation &&
        (!Number.isSafeInteger(delegation.hop) ||
          delegation.hop < 0 ||
          typeof delegation.allowDelegation !== "boolean")
      )
        throw new BridgeAccessError(403);
      caller = Object.freeze({
        issuer: projected.issuer,
        subject: projected.subject,
        tenant: projected.tenant,
        ...(delegation
          ? {
              delegation: Object.freeze({
                hop: delegation.hop,
                allowDelegation: delegation.allowDelegation,
              }),
            }
          : {}),
      });
      if (
        (params.tenant && params.tenant !== caller.tenant) ||
        (input.tenant && input.tenant !== caller.tenant)
      )
        throw new BridgeAccessError(403);
      let allowed = false;
      try {
        allowed = await this.auth.authorize({
          caller,
          operation,
          params,
          context: input,
        });
      } catch {
        throw new BridgeAccessError(403);
      }
      if (allowed !== true) throw new BridgeAccessError(403);
    } else if (params.tenant || input.tenant || input.user?.isAuthenticated) {
      throw new BridgeAccessError(403);
    }
    const scoped = new ServerCallContext({
      user: Object.freeze({
        isAuthenticated: !!caller,
        userName: JSON.stringify([
          this.binding,
          caller?.issuer ?? null,
          caller?.subject ?? null,
        ]),
      }),
      tenant: caller?.tenant ?? "",
      requestedVersion: input.requestedVersion,
      requestedExtensions: input.requestedExtensions,
    });
    if (caller) callers.set(scoped, caller);
    // Preserve SDK negotiated extension reporting on the original transport context.
    scoped.addActivatedExtension = input.addActivatedExtension.bind(input);
    scoped.setRequestedExtensions = input.setRequestedExtensions.bind(input);
    return scoped;
  }
}

export function validateHistory(params: { historyLength?: number }): void {
  if (
    params.historyLength !== undefined &&
    (!Number.isInteger(params.historyLength) || params.historyLength < 0)
  )
    throw new RequestMalformedError(
      "historyLength must be a non-negative integer",
    );
}
