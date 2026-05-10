import { describe, it, expect } from 'vitest';
import { TokenBucket, InMemoryTokenBucketStore } from '../src';

function fakeClock() {
  let t = 1_700_000_000_000;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

describe('TokenBucket (in-memory)', () => {
  it('starts full so the first burst goes through immediately', async () => {
    const clock = fakeClock();
    const b = new TokenBucket({
      burst: 5,
      refillPerSecond: 1,
      store: new InMemoryTokenBucketStore(),
      now: clock.now,
    });
    for (let i = 0; i < 5; i++) {
      const r = await b.take('user-1');
      expect(r.allowed).toBe(true);
    }
  });

  it('denies the request after the bucket is empty', async () => {
    const clock = fakeClock();
    const b = new TokenBucket({
      burst: 2,
      refillPerSecond: 1,
      store: new InMemoryTokenBucketStore(),
      now: clock.now,
    });
    expect((await b.take('u')).allowed).toBe(true);
    expect((await b.take('u')).allowed).toBe(true);
    const denied = await b.take('u');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('refills at the configured rate over wall-clock time', async () => {
    const clock = fakeClock();
    const b = new TokenBucket({
      burst: 2,
      refillPerSecond: 5,        // 1 token every 200 ms
      store: new InMemoryTokenBucketStore(),
      now: clock.now,
    });
    await b.take('u');
    await b.take('u');
    expect((await b.take('u')).allowed).toBe(false);
    clock.advance(200);
    expect((await b.take('u')).allowed).toBe(true);
    clock.advance(199);
    expect((await b.take('u')).allowed).toBe(false);
    clock.advance(1);            // total elapsed: 200 ms since last consume
    expect((await b.take('u')).allowed).toBe(true);
  });

  it('caps tokens at burst — idle buckets do not accumulate forever', async () => {
    const clock = fakeClock();
    const b = new TokenBucket({
      burst: 3,
      refillPerSecond: 100,
      store: new InMemoryTokenBucketStore(),
      now: clock.now,
    });
    await b.take('u');
    clock.advance(60_000);       // an hour of refill credit
    // First request after the long pause: bucket should be at burst-1 = 2.
    const after = await b.take('u');
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(2);
  });

  it('isolates buckets per key', async () => {
    const clock = fakeClock();
    const b = new TokenBucket({
      burst: 1,
      refillPerSecond: 0,
      store: new InMemoryTokenBucketStore(),
      now: clock.now,
    });
    expect((await b.take('a')).allowed).toBe(true);
    expect((await b.take('b')).allowed).toBe(true);
    expect((await b.take('a')).allowed).toBe(false);
    expect((await b.take('b')).allowed).toBe(false);
  });

  it('rejects nonsensical configuration', () => {
    const store = new InMemoryTokenBucketStore();
    expect(() => new TokenBucket({ burst: 0, refillPerSecond: 1, store })).toThrow();
    expect(() => new TokenBucket({ burst: 1, refillPerSecond: -1, store })).toThrow();
  });

  it('serialises concurrent updates so two parallel takes still see each other', async () => {
    const clock = fakeClock();
    const b = new TokenBucket({
      burst: 2,
      refillPerSecond: 0,
      store: new InMemoryTokenBucketStore(),
      now: clock.now,
    });
    const [a, b1, c] = await Promise.all([b.take('u'), b.take('u'), b.take('u')]);
    const allowed = [a, b1, c].filter((r) => r.allowed).length;
    expect(allowed).toBe(2);
  });
});
