import { createHash } from "node:crypto";
import { Operation } from "./operation.js";

/** Host canonical logical identity, never a token or other secret. */
export type CredentialOwner =
  | string
  | { issuer: string; subject: string; audience: string; tenant?: string };
export interface ClientCredential {
  owner: CredentialOwner;
  audience: string;
  headers: Record<string, string>;
}
export interface ClientRoutePolicy {
  destinationOrigins: readonly string[];
  /** Stable host-selected remote binding identity. */
  peerIdentity: string;
  credential?: {
    owner: CredentialOwner;
    audience: string;
    origins: readonly string[];
    headerNames: readonly string[];
    provide(input: {
      signal: AbortSignal;
      origin: string;
      audience: string;
    }): Promise<ClientCredential>;
  };
  /** Immutable trusted service parameters; unavailable to model tool arguments. */
  headers?: Readonly<Record<string, string>>;
}
function ownerKey(owner: CredentialOwner): string {
  if (typeof owner === "string") {
    if (!owner) throw new Error("A2A owner is required");
    return JSON.stringify([owner]);
  }
  if (!owner.issuer || !owner.subject || !owner.audience)
    throw new Error("A2A owner is incomplete");
  return JSON.stringify([
    owner.issuer,
    owner.subject,
    owner.audience,
    owner.tenant ?? null,
  ]);
}
export function destination(value: string): URL {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error("Invalid A2A destination");
  }
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.hash
  )
    throw new Error("Invalid A2A destination");
  return u;
}
function origins(values: readonly string[]): Set<string> {
  return new Set(
    values.map((value) => {
      const u = destination(value);
      if (u.pathname !== "/" || u.search)
        throw new Error("A2A scope must be an origin");
      return u.origin;
    }),
  );
}
export function compilePolicy(policy: ClientRoutePolicy) {
  const allowed = origins(policy.destinationOrigins);
  const credential = policy.credential;
  const scope = origins(credential?.origins ?? []);
  const owner = credential ? ownerKey(credential.owner) : "anonymous";
  const audience = credential?.audience;
  const provide = credential?.provide;
  if (
    !policy.peerIdentity ||
    (credential && (!audience || !credential.headerNames.length))
  )
    throw new Error("Incomplete A2A policy");
  for (const origin of scope)
    if (!allowed.has(origin))
      throw new Error("Credential origin must be an approved destination");
  let trusted: Headers;
  try {
    trusted = new Headers(policy.headers);
  } catch {
    throw new Error("Invalid A2A policy headers");
  }
  for (const name of ["authorization", "proxy-authorization", "cookie"])
    if (trusted.has(name))
      throw new Error(
        "Use identity-scoped A2A credentials for authentication headers",
      );
  const names = new Set(
    (credential?.headerNames ?? []).map((name) => name.toLowerCase()),
  );
  for (const name of names) {
    new Headers({ [name]: "" });
    if (trusted.has(name)) throw new Error("Conflicting A2A policy headers");
  }
  const protectedNames = new Set([
    "authorization",
    "proxy-authorization",
    "cookie",
    "host",
    ...names,
    ...trusted.keys(),
  ]);
  const check = (value: string) => {
    if (!allowed.has(destination(value).origin))
      throw new Error("Unapproved A2A destination");
  };
  const identity = createHash("sha256")
    .update(JSON.stringify([policy.peerIdentity, owner, audience ?? null]))
    .digest("hex");
  return {
    identity,
    check,
    signature: JSON.stringify([
      [...allowed].sort(),
      [...scope].sort(),
      identity,
      [...names].sort(),
      [...trusted.entries()],
    ]),
    provide,
    fetch(base: typeof fetch, timeoutMs: number): typeof fetch {
      return Object.assign(
        async (request: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const operation = new Operation(
            timeoutMs,
            init?.signal ??
              (request instanceof Request ? request.signal : undefined),
          );
          try {
            const url =
              typeof request === "string"
                ? request
                : request instanceof URL
                  ? request.href
                  : request.url;
            check(url);
            const headers = new Headers(
              init?.headers ??
                (request instanceof Request ? request.headers : undefined),
            );
            // Inspect both sources independently: custom fetch adapters may merge
            // Request headers even when init supplies replacement headers.
            for (const name of protectedNames)
              if (
                headers.has(name) ||
                (request instanceof Request && request.headers.has(name))
              )
                throw new Error("Protected A2A request header");
            trusted.forEach((value, name) => headers.set(name, value));
            if (provide && scope.has(new URL(url).origin)) {
              const result = await operation.run(() =>
                provide({
                  signal: operation.signal,
                  origin: new URL(url).origin,
                  audience: audience!,
                }),
              );
              if (
                ownerKey(result.owner) !== owner ||
                result.audience !== audience
              )
                throw new Error("A2A credential identity changed");
              const supplied = new Headers(result.headers);
              for (const name of supplied.keys())
                if (!names.has(name))
                  throw new Error("Undeclared A2A credential header");
              for (const name of names)
                if (!supplied.has(name))
                  throw new Error("Missing A2A credential header");
              supplied.forEach((value, name) => headers.set(name, value));
            }
            operation.signal.throwIfAborted();
            operation.close();
            const response = await base(request, {
              ...init,
              headers,
              redirect: "error",
              credentials: "omit",
            });
            try {
              if (
                response.redirected ||
                (response.status >= 300 && response.status < 400) ||
                !response.ok
              )
                throw new Error("A2A HTTP request rejected");
              if (response.url) check(response.url);
            } catch {
              // Release rejected bodies without letting uncooperative cleanup
              // delay the operation or expose a cleanup exception.
              try {
                void response.body?.cancel().catch(() => {});
              } catch {}
              throw new Error("A2A HTTP request rejected");
            }
            return response;
          } catch {
            throw new Error("A2A policy request failed");
          } finally {
            operation.close();
          }
        },
        base,
      );
    },
  };
}
