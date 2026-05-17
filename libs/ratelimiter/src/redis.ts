import { ComputeFn, TokenBucketStore } from './store';

/**
 * Redis-backed bucket store. Atomic via a single Lua script.
 *
 * Layout:
 *   key = `rl:<bucket>:<id>`  -> hash { tokens, last_refill_ms }
 *
 * The Lua script reads the hash, runs the *exact* same algorithm as the
 * TypeScript `compute` function (we pass `burst` and `refillPerMs` in as
 * args so the implementation stays in one place — there is no "drift"
 * risk because the contract is verified by the same test suite running
 * against both stores).
 *
 * NOTE: We deliberately reimplement the algorithm in Lua rather than
 * round-tripping the JS `compute` callback so the operation is atomic
 * server-side. This means the Redis store ignores the JS `compute`
 * callback's branching except via its inputs (burst, refillRate),
 * which is fine for token-bucket semantics.
 */

interface RedisLike {
  defineCommand?(
    name: string,
    def: { numberOfKeys: number; lua: string },
  ): unknown;
  evalsha?(...args: unknown[]): Promise<unknown>;
  // ioredis decorates the client with the dynamically-defined command
  // method; we reach for it via index access at call time.
  [key: string]: unknown;
}

const LUA = `
local key      = KEYS[1]
local now_ms   = tonumber(ARGV[1])
local burst    = tonumber(ARGV[2])
local refillpm = tonumber(ARGV[3])      -- tokens per millisecond
local cost     = tonumber(ARGV[4])      -- tokens to consume

local data = redis.call('HMGET', key, 'tokens', 'last_refill_ms')
local tokens = tonumber(data[1])
local last_ms = tonumber(data[2])

if tokens == nil then
  tokens = burst
  last_ms = now_ms
end

local elapsed = math.max(0, now_ms - last_ms)
local refilled = math.min(burst, tokens + elapsed * refillpm)

local allowed = 0
local retry_after = 0
if refilled >= cost then
  refilled = refilled - cost
  allowed = 1
else
  local deficit = cost - refilled
  if refillpm > 0 then
    retry_after = math.ceil(deficit / refillpm)
  else
    retry_after = -1
  end
end

redis.call('HMSET', key, 'tokens', refilled, 'last_refill_ms', now_ms)
-- 1 day TTL, plenty for a bucket that refills constantly while seen.
redis.call('PEXPIRE', key, 86400000)

return { allowed, retry_after, tostring(refilled) }
`;

export class RedisTokenBucketStore implements TokenBucketStore {
  private readonly client: RedisLike;
  private readonly burst: number;
  private readonly refillPerMs: number;
  private readonly keyPrefix: string;
  private defined = false;

  constructor(opts: {
    redis: RedisLike;
    burst: number;
    refillPerSecond: number;
    keyPrefix?: string;
  }) {
    this.client = opts.redis;
    this.burst = opts.burst;
    this.refillPerMs = opts.refillPerSecond / 1000;
    this.keyPrefix = opts.keyPrefix ?? 'rl';
  }

  async getAndUpdate(
    key: string,
    nowMs: number,
    _compute: ComputeFn,
  ): Promise<{ allowed: boolean; retryAfterMs: number; tokens: number }> {
    this.ensureCommandDefined();
    const fullKey = `${this.keyPrefix}:${key}`;
    const result = (await (
      this.client as unknown as {
        ridexRateLimit: (
          key: string,
          nowMs: number,
          burst: number,
          refillPerMs: number,
          cost: number,
        ) => Promise<[number, number, string]>;
      }
    ).ridexRateLimit(fullKey, nowMs, this.burst, this.refillPerMs, 1)) as [
      number,
      number,
      string,
    ];

    const [allowed, retryAfterMs, tokensStr] = result;
    const tokens = Number(tokensStr);
    return {
      allowed: allowed === 1,
      retryAfterMs: retryAfterMs < 0 ? Number.POSITIVE_INFINITY : retryAfterMs,
      tokens: Number.isFinite(tokens) ? tokens : 0,
    };
  }

  private ensureCommandDefined() {
    if (this.defined) return;
    if (typeof this.client.defineCommand !== 'function') {
      throw new Error('Redis client does not support defineCommand');
    }
    this.client.defineCommand('ridexRateLimit', { numberOfKeys: 1, lua: LUA });
    this.defined = true;
  }
}
