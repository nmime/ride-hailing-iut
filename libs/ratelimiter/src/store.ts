/**
 * Storage abstraction for the token-bucket state.
 *
 * The bucket algorithm is identical in every backend; we only swap the
 * persistence layer. `getAndUpdate` is a single atomic step that:
 *   1. reads the latest (tokens, last_refill_ms) for the key,
 *   2. computes new state via the caller-supplied `compute` function,
 *   3. writes the new state back if the caller returns one.
 *
 * Atomicity is the responsibility of the implementation. The in-memory
 * store can simply lock per key; the Redis store uses a Lua script.
 */

export interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export type ComputeFn = (
  prev: BucketState | null,
  nowMs: number,
) => { next: BucketState; allowed: boolean; retryAfterMs: number };

export interface TokenBucketStore {
  /**
   * Atomically read the bucket state for `key`, run the supplied function
   * to derive the next state, persist it, and return the function's result.
   *
   * The store is responsible for monotonicity: two concurrent calls must
   * see one another's writes.
   */
  getAndUpdate(
    key: string,
    nowMs: number,
    compute: ComputeFn,
  ): Promise<{ allowed: boolean; retryAfterMs: number; tokens: number }>;
}
