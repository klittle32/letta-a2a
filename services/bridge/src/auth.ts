import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import type { Request, RequestHandler } from "express";
import type { UserBuilder } from "@a2a-js/sdk/server/express";
import {
  BridgeAccessError,
  delegationPolicy,
  type BridgeAuthorization,
} from "letta-a2a-bridge";
import { extractMessageText } from "./mapping.js";

export interface AuthOptions {
  issuer: string;
  audience: string;
  jwksUrl: string;
  maximumHops: number;
  /** Test seam only; production uses bounded remote JWKS retrieval. */
  keyResolver?: JWTVerifyGetKey;
}

/** Credentials and authorization live on request-local, app-owned objects, not subjects. */
export function createServiceAuth(options: AuthOptions) {
  const key =
    options.keyResolver ??
    createRemoteJWKSet(new URL(options.jwksUrl), {
      timeoutDuration: 5000,
      cooldownDuration: 30000,
      cacheMaxAge: 600000,
    });
  const requests = new WeakMap<Request, JWTPayload>();
  const users = new WeakMap<object, { claims: JWTPayload; request: Request }>();
  const middleware: RequestHandler = async (req, res, next) => {
    try {
      const header = req.headers.authorization;
      if (!header || !/^Bearer [^\s]+$/i.test(header)) throw new Error();
      const { payload } = await jwtVerify(header.slice(7), key, {
        issuer: options.issuer,
        audience: options.audience,
        requiredClaims: ["sub", "exp", "nbf", "scope", "role"],
        algorithms: ["RS256"],
      });
      if (typeof payload.sub !== "string" || !payload.sub.trim())
        throw new Error();
      if (payload.tenant !== undefined && typeof payload.tenant !== "string")
        throw new Error();
      requests.set(req, payload);
      next();
    } catch {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.setHeader("Cache-Control", "private, no-store");
      res.status(401).json({ error: "Authentication required" });
    }
  };
  const userBuilder: UserBuilder = async (request) => {
    const claims = requests.get(request);
    if (!claims) throw new BridgeAccessError(401);
    const user = Object.freeze({
      isAuthenticated: true,
      userName: claims.sub!,
    });
    users.set(user, { claims, request });
    return user;
  };
  const authorization: BridgeAuthorization = {
    projectCaller(context) {
      const verified = context.user && users.get(context.user);
      if (!verified) return undefined;
      const { claims, request } = verified;
      // Only send operations carry execution policy; reads and discovery need no hop.
      const method = request.body?.method;
      const sending = [
        "SendMessage",
        "SendStreamingMessage",
        "message/send",
        "message/stream",
      ].includes(method);
      let delegation;
      if (sending) {
        try {
          delegation = executionPolicy(
            claims,
            request,
            request.body?.params,
            options.maximumHops,
          );
        } catch {
          /* authorize rejects invalid execution policy with a sanitized 403. */
        }
      }
      return {
        issuer: options.issuer,
        subject: claims.sub!,
        tenant: (claims.tenant as string) ?? "",
        ...(delegation ? { delegation } : {}),
      };
    },
    authorize({ operation, context, params, caller }) {
      const verified = context.user && users.get(context.user);
      if (!verified) return false;
      const { claims, request } = verified;
      const scopes =
        typeof claims.scope === "string" ? claims.scope.split(/\s+/) : [];
      if (operation === "discover") return scopes.includes("a2a.discover");
      if (
        !scopes.includes("a2a.invoke") ||
        typeof claims.role !== "string" ||
        !["operator", "agent"].includes(claims.role)
      )
        return false;
      if (operation === "sendMessage" || operation === "sendMessageStream") {
        const policy = executionPolicy(
          claims,
          request,
          params,
          options.maximumHops,
        );
        return (
          caller.delegation?.hop === policy.hop &&
          caller.delegation.allowDelegation === policy.allowDelegation
        );
      }
      return true;
    },
  };
  return {
    authorization,
    transport: { middleware: [middleware], userBuilder },
  };
}

function executionPolicy(
  claims: JWTPayload,
  request: Request,
  params: any,
  maximumHops: number,
) {
  const delegatedCaller = claims.role === "agent";
  const header = request.headers["x-letta-a2a-hop"];
  if (Array.isArray(header)) throw new Error("Invalid hop");
  const legacy = params?.metadata?.lettaA2aLab?.hop;
  let hopHeader = header;
  if (legacy !== undefined) {
    if (!Number.isSafeInteger(legacy) || legacy < 0)
      throw new Error("Invalid hop");
    if (delegatedCaller) {
      if (legacy <= 0 || (header !== undefined && header !== String(legacy)))
        throw new Error("Invalid hop");
      hopHeader = String(legacy);
    } else if (legacy !== 0) throw new Error("Invalid hop");
  }
  const policy = delegationPolicy({
    text: extractMessageText(params?.message),
    returnImmediately:
      params?.configuration?.returnImmediately === true ||
      params?.configuration?.blocking === false,
    delegatedCaller,
    hopHeader,
    maximumHops,
  });
  return { hop: policy.hop, allowDelegation: policy.allowDelegation };
}
