/** Race even non-cooperative SDK implementations against the operation signal. */
export function bounded<T>(
  work: () => T | PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    let attached = true;
    const detach = () => {
      if (!attached) return;
      attached = false;
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      detach();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return work();
      })
      .then(
        (value) => {
          detach();
          resolve(value);
        },
        (error) => {
          detach();
          reject(error);
        },
      );
  });
}

/**
 * timeoutMs includes cleanup and is capped by the optional absolute monotonic
 * deadline. Reserve up to 20% of the remaining budget for independent cleanup;
 * time already spent in an outer service queue is never granted again.
 */
export class Operation {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly timer?: ReturnType<typeof setTimeout>;
  private readonly deadline: number;
  private readonly workDeadline: number;

  constructor(
    timeoutMs: number,
    readonly caller?: AbortSignal,
    reserveMs = 0,
    deadline?: number,
  ) {
    const now = performance.now();
    this.deadline = Math.min(now + timeoutMs, deadline ?? Infinity);
    const remaining = Math.max(0, this.deadline - now);
    this.workDeadline = this.deadline - Math.min(reserveMs, remaining / 5);
    this.signal = caller
      ? AbortSignal.any([caller, this.controller.signal])
      : this.controller.signal;
    if (!Number.isFinite(this.deadline) || this.workDeadline <= now) {
      this.expire();
    } else {
      this.timer = setTimeout(() => this.expire(), this.workDeadline - now);
    }
  }

  async run<T>(work: () => T | PromiseLike<T>): Promise<T> {
    const checkDeadline = () => {
      // Check the clock too: an expired timer may still be queued for delivery.
      if (performance.now() >= this.workDeadline) this.expire();
      this.signal.throwIfAborted();
    };
    const result = await bounded(() => {
      checkDeadline();
      return work();
    }, this.signal);
    checkDeadline();
    return result;
  }

  async cleanup<T>(
    work: (signal: AbortSignal) => T | PromiseLike<T>,
    limitMs: number,
  ): Promise<T | undefined> {
    const now = performance.now();
    const cleanupDeadline = Math.min(this.deadline, now + limitMs);
    if (!(cleanupDeadline > now)) return undefined;
    const controller = new AbortController();
    const expire = () => controller.abort(new Error("A2A cleanup timed out"));
    const timer = setTimeout(expire, cleanupDeadline - now);
    try {
      const value = await bounded(() => {
        if (performance.now() >= cleanupDeadline) expire();
        controller.signal.throwIfAborted();
        return work(controller.signal);
      }, controller.signal);
      if (performance.now() >= cleanupDeadline) return undefined;
      return value;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
      expire();
    }
  }

  private expire(): void {
    this.controller.abort(new Error("A2A operation timed out"));
  }

  close(): void {
    clearTimeout(this.timer);
    this.controller.abort(new Error("A2A operation closed"));
  }
}
