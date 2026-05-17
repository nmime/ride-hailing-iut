/**
 * Token-bucket rate limiter (R11 — from-scratch component, alongside the
 * consistent-hash ring).
 *
 * Algorithm — see Tanenbaum's *Computer Networks* §5.3.4 ("Traffic shaping")
 * and Alex Xu's *System Design Interview Vol. 1* ch. 4 ("Rate limiter").
 *
 *   bucket holds N tokens, capacity = burst. Each request costs 1 token.
 *   The bucket refills at refillRate tokens per second. Empty bucket -> deny.
 *
 *   Refill is computed lazily on every check: we record `lastRefillMs` and
 *   on the next request add `(now - lastRefillMs) * refillRate / 1000`
 *   tokens, capped at `burst`. This avoids a background timer per key.
 *
 * Storage is pluggable so the same algorithm runs in:
 *   - process memory (per-pod, fastest, no cross-pod sharing),
 *   - Redis (cluster-wide, exact, atomic via Lua),
 *
 * Both backends implement {@link TokenBucketStore}.
 *
 * Integration in RideX:
 *   - Wrapped by `apps/api/src/ratelimit/ratelimit.guard.ts` as a global
 *     guard, keyed by `user_id` for authenticated routes and by client
 *     IP for `/auth/*`. The store defaults to Redis so two API replicas
 *     share a single bucket per user.
 */

import { ComputeFn, TokenBucketStore } from './store';

export interface TokenBucketOptions {
  /** Maximum number of tokens the bucket can hold ("burst"). */
  burst: number;
  /** Sustained tokens added per second. */
  refillPerSecond: number;
  /** Backing store. */
  store: TokenBucketStore;
  /** Now provider, exposed for testing. */
  now?: () => number;
}

export interface TokenBucketDecision {
  /** True if the request was allowed (one token consumed). */
  allowed: boolean;
  /** Tokens left after this decision (zero or more). */
  remaining: number;
  /** If denied, the milliseconds the caller should wait before retrying. */
  retryAfterMs: number;
}

export class TokenBucket {
  private readonly burst: number;
  private readonly refillPerMs: number;
  private readonly store: TokenBucketStore;
  private readonly now: () => number;

  constructor(opts: TokenBucketOptions) {
    if (opts.burst <= 0) throw new Error('burst must be > 0');
    if (opts.refillPerSecond < 0) throw new Error('refillPerSecond must be >= 0');
    this.burst = opts.burst;
    this.refillPerMs = opts.refillPerSecond / 1000;
    this.store = opts.store;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Try to consume one token for `key`. Returns the decision. */
  async take(key: string): Promise<TokenBucketDecision> {
    const compute: ComputeFn = (prev, nowMs) => {
      // First touch — start the bucket full so a brand new client gets
      // the configured burst, not zero.
      const tokens = prev?.tokens ?? this.burst;
      const lastRefillMs = prev?.lastRefillMs ?? nowMs;

      const elapsedMs = Math.max(0, nowMs - lastRefillMs);
      const refilled = Math.min(this.burst, tokens + elapsedMs * this.refillPerMs);

      if (refilled >= 1) {
        return {
          next: { tokens: refilled - 1, lastRefillMs: nowMs },
          allowed: true,
          retryAfterMs: 0,
        };
      }
      // Not enough tokens. Compute when the next whole token will be ready.
      const deficit = 1 - refilled;
      const retryAfterMs =
        this.refillPerMs > 0
          ? Math.ceil(deficit / this.refillPerMs)
          : Number.POSITIVE_INFINITY;
      return {
        next: { tokens: refilled, lastRefillMs: nowMs },
        allowed: false,
        retryAfterMs,
      };
    };

    const result = await this.store.getAndUpdate(key, this.now(), compute);
    return {
      allowed: result.allowed,
      remaining: Math.floor(result.tokens),
      retryAfterMs: result.retryAfterMs,
    };
  }

  /** Capacity getter, exposed for /metrics. */
  get capacity() { return this.burst; }
  /** Refill rate getter, exposed for /metrics. */
  get refillRate() { return this.refillPerMs * 1000; }
}
