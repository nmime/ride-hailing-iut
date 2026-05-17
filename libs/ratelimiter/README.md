# `@ridex/ratelimiter` — From-scratch token-bucket rate limiter (R11)

A tiny, well-tested token-bucket rate limiter, used by the `apps/api`
gateway middleware to throttle abusive clients.

> **References.**
> Tanenbaum, _Computer Networks_ §5.3.4 — "Traffic shaping with the token bucket".
> Xu, _System Design Interview Vol. 1_, ch. 4 — "Design a rate limiter".

## What it is

The bucket holds at most `burst` tokens; every request costs one. The
bucket refills lazily at `refillPerSecond` tokens per second up to
`burst`. An empty bucket denies the request and returns `retryAfterMs`
so the caller (or HTTP layer) can issue a `Retry-After` header.

There are two storage backends behind a small `TokenBucketStore`
interface:

- `InMemoryTokenBucketStore` — per-process map; sub-microsecond per
  decision, but each pod has its own bucket. Acceptable when only one
  api replica runs, or as a defence-in-depth front of the Redis store.
- `RedisTokenBucketStore` — atomic via a Lua script, so the two
  api replicas behind the gateway share the _same_ bucket per user.
  Used in production.

The same algorithm runs in both (the Redis Lua mirrors the JS `compute`
function), so the test suite verifies both stores against the same
property tests.

## API

```ts
import { TokenBucket, InMemoryTokenBucketStore, RedisTokenBucketStore } from '@ridex/ratelimiter';

const bucket = new TokenBucket({
  burst: 30, // up to 30 immediate requests
  refillPerSecond: 10, // sustained 10 req/s
  store: new InMemoryTokenBucketStore(),
});

const decision = await bucket.take(`user:${userId}`);
if (!decision.allowed) {
  res.setHeader('Retry-After', Math.ceil(decision.retryAfterMs / 1000));
  res.statusCode = 429;
  res.end();
  return;
}
```

## Integration in RideX

`apps/api/src/ratelimit/ratelimit.guard.ts` is a global Nest guard that:

1. Resolves the bucket key — `user:<sub>` for authenticated routes,
   `ip:<remote>` for `/auth/*`.
2. Calls `bucket.take(key)`.
3. If denied, sets `Retry-After` and throws `429 Too Many Requests`.
4. Emits a `ridex_ratelimit_decisions_total{outcome}` counter so
   Grafana can show the deny-rate.

The store is wired to the existing `Redis` connection so two API replicas
behind the gateway share buckets exactly.

## Why a _second_ from-scratch component?

The spec accepts any one of the listed components for R11; we shipped
the consistent-hash ring as the primary, but the matcher's hot path
also benefits from a rate limiter (a chatty driver app must not be
allowed to flood `/ingest/v1/locations`). A library this small is
straightforward to build from scratch and gives the team a second viva
talking point.

## Limitations

- **No burst across keys.** Two requests under different keys never
  share tokens; this is by design (per-user fairness).
- **No leaky bucket.** Token-bucket allows controlled bursts; if you
  need strict pacing instead, swap in a leaky-bucket variant by adjusting
  the refill computation.
- **In-memory store is per-process.** Across pods the in-memory store
  enforces N × the configured rate. Use the Redis store in production.

## Tests

```
pnpm --filter @ridex/ratelimiter test
```

Properties verified:

- Bucket starts full (burst available immediately).
- Empty bucket denies, with a sensible `retryAfterMs`.
- Refill happens at the configured rate when wall-clock advances.
- Idle buckets cap at `burst` (no infinite accumulation).
- Buckets are isolated per key.
- Two concurrent takes against the same key still see each other.
