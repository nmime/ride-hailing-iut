import { BucketState, ComputeFn, TokenBucketStore } from './store';

/**
 * In-process bucket store.
 *
 * - `Map<string, BucketState>` keeps state per key.
 * - `Map<string, Promise>` serialises concurrent updates for the same key
 *   so two requests that arrive in the same tick still see each other's
 *   writes. We don't need a real mutex because Node.js is single-threaded
 *   on the event loop, but we *do* need to await any in-flight `compute`
 *   for the key before issuing the next.
 *
 * Memory is bounded by an LRU eviction once the map exceeds `maxKeys`.
 * The eviction is age-based: oldest `lastRefillMs` first.
 */
export class InMemoryTokenBucketStore implements TokenBucketStore {
  private readonly state = new Map<string, BucketState>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly maxKeys: number;

  constructor(opts: { maxKeys?: number } = {}) {
    this.maxKeys = Math.max(1, opts.maxKeys ?? 100_000);
  }

  async getAndUpdate(
    key: string,
    nowMs: number,
    compute: ComputeFn,
  ): Promise<{ allowed: boolean; retryAfterMs: number; tokens: number }> {
    const prior = this.inflight.get(key) ?? Promise.resolve();
    const next = prior.then(() => {
      const prev = this.state.get(key) ?? null;
      const out = compute(prev, nowMs);
      this.state.set(key, out.next);
      this.maybeEvict();
      return {
        allowed: out.allowed,
        retryAfterMs: out.retryAfterMs,
        tokens: out.next.tokens,
      };
    });
    this.inflight.set(key, next);
    try { return await (next as Promise<{ allowed: boolean; retryAfterMs: number; tokens: number }>); }
    finally {
      // Drop the chain head once it's settled, preventing unbounded growth.
      if (this.inflight.get(key) === next) this.inflight.delete(key);
    }
  }

  private maybeEvict(): void {
    if (this.state.size <= this.maxKeys) return;
    // Linear scan eviction; acceptable for the modest cap.
    let oldestKey: string | null = null;
    let oldestMs = Number.POSITIVE_INFINITY;
    for (const [k, v] of this.state) {
      if (v.lastRefillMs < oldestMs) {
        oldestMs = v.lastRefillMs;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) this.state.delete(oldestKey);
  }
}
