import type {
  A2AInvocationResult,
  A2AInvoker,
} from "./a2a-invoker.js";
import { A2AInvocationCancelledError } from "./a2a-invoker.js";
import type { ContextStore } from "./context-store.js";

export interface A2AToolInput {
  target: string;
  message: string;
  localScope: string;
  contextId?: string;
  newContext?: boolean;
  signal: AbortSignal;
}

/** Adds route policy and automatic conversation continuity around A2A calls. */
export class A2AToolService {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly routes: Record<string, string>,
    private readonly invoker: A2AInvoker,
    private readonly contexts: ContextStore,
  ) {}

  async invoke(input: A2AToolInput): Promise<A2AInvocationResult> {
    const url = this.routes[input.target];
    if (!url) {
      throw new Error(
        `Unknown A2A target ${JSON.stringify(input.target)}. Configured targets: ${Object.keys(this.routes).sort().join(", ")}`,
      );
    }
    if (!input.message.trim()) throw new Error("A2A message is required");

    const stateKey = `${input.localScope}/${input.target}`;
    return this.withLock(stateKey, input.signal, async () => {
      const contextId =
        input.contextId ??
        (input.newContext ? undefined : await this.contexts.get(stateKey));
      const result = await this.invoker.invoke({
        url,
        message: input.message.trim(),
        contextId,
        signal: input.signal,
      });
      if (result.contextId) {
        await this.contexts.set(stateKey, result.contextId);
      }
      return result;
    });
  }

  private async withLock<T>(
    key: string,
    signal: AbortSignal,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    void tail.finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });

    try {
      await waitForPreviousCall(previous, signal);
      return await work();
    } finally {
      release();
    }
  }
}

function waitForPreviousCall(
  previous: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(new A2AInvocationCancelledError());

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new A2AInvocationCancelledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    previous.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
