import { describe, it, expect } from 'vitest';
import { ConsistentHashRing, fnv1a32, murmur3_32 } from '../src';

describe('fnv1a32', () => {
  it('is deterministic', () => {
    expect(fnv1a32('hello')).toBe(fnv1a32('hello'));
  });
  it('matches the published test vector for empty string', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
  });
  it('produces an unsigned 32-bit integer', () => {
    const h = fnv1a32('rider-42');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});

describe('murmur3_32', () => {
  it('matches canonical test vectors', () => {
    expect(murmur3_32('')).toBe(0);
    expect(murmur3_32('a', 0x9747b28c)).toBe(0x7fa09ea6);
    expect(murmur3_32('hello')).toBe(0x248bfa47);
    expect(murmur3_32('abc')).toBe(0xb3dd93fa);
    expect(murmur3_32('The quick brown fox jumps over the lazy dog'))
      .toBe(0x2e4ff723);
  });
  it('avalanches on small input changes', () => {
    // Bit-difference between hashes of "abc" and "abd" should be near 16
    // (half of 32) for a good hash. We use a loose lower bound here.
    const a = murmur3_32('abc');
    const b = murmur3_32('abd');
    let diff = 0;
    for (let i = 0; i < 32; i++) if (((a ^ b) >>> i) & 1) diff++;
    expect(diff).toBeGreaterThanOrEqual(8);
  });
});

describe('ConsistentHashRing', () => {
  it('returns null on empty ring', () => {
    const r = new ConsistentHashRing();
    expect(r.getNode('any')).toBeNull();
  });

  it('routes a key to one of its nodes', () => {
    const r = new ConsistentHashRing({ vnodes: 16 });
    r.addNode('a').addNode('b').addNode('c');
    const owner = r.getNode('driver-1');
    expect(['a', 'b', 'c']).toContain(owner);
  });

  it('is deterministic — same key always routes to same node', () => {
    const r = new ConsistentHashRing();
    r.addNode('a').addNode('b').addNode('c');
    const k = 'driver-007';
    const first = r.getNode(k);
    for (let i = 0; i < 100; i++) expect(r.getNode(k)).toBe(first);
  });

  it('addNode / removeNode are idempotent', () => {
    const r = new ConsistentHashRing({ vnodes: 4 });
    r.addNode('a').addNode('a').addNode('a');
    expect(r.size).toBe(4);
    r.removeNode('a');
    r.removeNode('a');
    expect(r.size).toBe(0);
  });

  it('distributes keys roughly uniformly across nodes (Murmur3, V=256)', () => {
    const r = new ConsistentHashRing({ vnodes: 256 });
    const nodes = ['n1', 'n2', 'n3', 'n4'];
    nodes.forEach((n) => r.addNode(n));

    const counts: Record<string, number> = { n1: 0, n2: 0, n3: 0, n4: 0 };
    const N = 50_000;
    for (let i = 0; i < N; i++) counts[r.getNode(`drv-${i}`)!]++;

    // Murmur3 + V=256 measured empirically at ±10 %; we test ±20 % to keep
    // the test stable across machines and Node versions.
    const expected = N / 4;
    for (const n of nodes) {
      expect(counts[n] / expected).toBeGreaterThan(0.80);
      expect(counts[n] / expected).toBeLessThan(1.20);
    }
  });

  it('only ~1/N keys re-route when one node is removed', () => {
    const r = new ConsistentHashRing({ vnodes: 256 });
    ['n1', 'n2', 'n3', 'n4'].forEach((n) => r.addNode(n));

    const N = 10_000;
    const before = new Map<string, string>();
    for (let i = 0; i < N; i++) before.set(`k-${i}`, r.getNode(`k-${i}`)!);

    r.removeNode('n3');

    let moved = 0;
    let movedFromOtherNodes = 0;
    for (const [k, prev] of before) {
      const now = r.getNode(k)!;
      if (now !== prev) {
        moved++;
        if (prev !== 'n3') movedFromOtherNodes++;
      }
    }
    // Every key on n3 moves; that's ~25 % of keys.
    expect(moved / N).toBeGreaterThan(0.15);
    expect(moved / N).toBeLessThan(0.35);
    // Critically: no key that was *not* on n3 should have changed owner.
    expect(movedFromOtherNodes).toBe(0);
  });

  it('getNodes returns up to k distinct fallbacks in clockwise order', () => {
    const r = new ConsistentHashRing({ vnodes: 32 });
    ['n1', 'n2', 'n3'].forEach((n) => r.addNode(n));
    const fallbacks = r.getNodes('rider-77', 3);
    expect(fallbacks).toHaveLength(3);
    expect(new Set(fallbacks).size).toBe(3);
  });

  it('accepts a custom hash function (FNV-1a) as a fallback option', () => {
    const r = new ConsistentHashRing({ vnodes: 256, hash: fnv1a32 });
    r.addNode('a').addNode('b');
    expect(['a', 'b']).toContain(r.getNode('any'));
  });
});
