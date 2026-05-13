/**
 * Consistent-hashing ring (R11 — from-scratch component).
 *
 * Algorithm — see Karger et al. 1997 ("Consistent Hashing and Random Trees")
 * and Designing Data-Intensive Applications, ch. 6 ("Partitioning by hash").
 *
 *   1. The ring is the integer interval [0, 2^32). We hash both nodes and
 *      keys into the same space using `fnv1a32`.
 *   2. Each node is placed on the ring at *V* virtual positions, where
 *      `V = vnodes`. More vnodes => more uniform load distribution at the
 *      cost of larger memory and slightly slower lookups.
 *   3. To route a key, hash it, then walk *clockwise* to the first vnode
 *      we encounter. The owner of that vnode owns the key.
 *
 * Internal representation:
 *   - `_positions`: a sorted array of (hash, nodeId) pairs.
 *   - Lookup is O(log V·N) via binary search.
 *
 * Properties this code relies on (and asserts via tests):
 *   - addNode / removeNode preserve the sort invariant.
 *   - When a node is removed, only the keys mapped to that node's vnodes
 *     shift; ~1/N of keys move. The other ~ (N-1)/N keys keep their
 *     existing owner.
 *
 * Integration point in RideX:
 *   - The matcher service runs N replicas. Each driver's location stream
 *     must land on one specific replica so per-driver state (recent path,
 *     match candidacy) lives in-process.
 *   - On startup, every replica knows the membership list (from
 *     `MATCHER_REPLICA_IDS`, an env var or a Redis key updated by an
 *     orchestrator). Each replica builds an identical ring locally.
 *   - When the matcher consumes a Kafka message keyed by `driver_id`, it
 *     calls `ring.getNode(driver_id)`. If that's its own ID, process it;
 *     otherwise drop it (someone else owns it). With kafka partitions ==
 *     replica count and partition key == driver_id, the message will arrive
 *     at the right replica anyway, but the ring is the system of record.
 */

import { murmur3_32 } from './hash';

export type HashFn = (input: string) => number;

export interface RingOptions {
  /** Virtual nodes per real node. Default 128, a common rule of thumb. */
  vnodes?: number;
  /** Hash function. Defaults to Murmur3 32-bit (better avalanche than FNV-1a
   *  on similar inputs like `"matcher-0#1"` vs `"matcher-0#2"`). */
  hash?: HashFn;
}

interface VNode {
  hash: number;     // position on the ring
  nodeId: string;   // owning real node
}

export class ConsistentHashRing {
  private readonly vnodes: number;
  private readonly hash: HashFn;
  /** Sorted by `hash` ascending. Mutated on add / remove. */
  private _positions: VNode[] = [];
  /** Live node IDs, kept so we can iterate / report membership. */
  private _nodes = new Set<string>();

  constructor(opts: RingOptions = {}) {
    this.vnodes = opts.vnodes ?? 128;
    this.hash = opts.hash ?? murmur3_32;
  }

  /** Membership snapshot — useful for /metrics and admin views. */
  get nodes(): string[] {
    return [...this._nodes].sort();
  }

  get size(): number {
    return this._positions.length;
  }

  /** Insert a node. Idempotent. */
  addNode(nodeId: string): this {
    if (this._nodes.has(nodeId)) return this;
    this._nodes.add(nodeId);
    for (let i = 0; i < this.vnodes; i++) {
      const h = this.hash(`${nodeId}#${i}`);
      this._insertSorted({ hash: h, nodeId });
    }
    return this;
  }

  /** Remove a node. Idempotent. */
  removeNode(nodeId: string): this {
    if (!this._nodes.has(nodeId)) return this;
    this._nodes.delete(nodeId);
    this._positions = this._positions.filter((p) => p.nodeId !== nodeId);
    return this;
  }

  /**
   * Find the owner of `key`. Returns null only if the ring is empty.
   * O(log size) via binary search.
   */
  getNode(key: string): string | null {
    if (this._positions.length === 0) return null;
    const h = this.hash(key);
    const idx = this._lowerBound(h);
    // Wrap around — clockwise lookup means "first vnode whose hash >= h",
    // and if none then we wrap to the smallest vnode.
    const slot = this._positions[idx % this._positions.length];
    return slot.nodeId;
  }

  /** Like getNode, but returns the next k *distinct* node IDs clockwise.
   *  Useful for read replicas / fallback assignment. */
  getNodes(key: string, k: number): string[] {
    if (this._positions.length === 0 || k <= 0) return [];
    const h = this.hash(key);
    const start = this._lowerBound(h);
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = 0; i < this._positions.length && out.length < k; i++) {
      const slot = this._positions[(start + i) % this._positions.length];
      if (!seen.has(slot.nodeId)) {
        seen.add(slot.nodeId);
        out.push(slot.nodeId);
      }
    }
    return out;
  }

  // ---------- internals ----------

  /** Returns the smallest index `i` such that `_positions[i].hash >= h`,
   *  or `_positions.length` if no such index exists (i.e. wrap-around). */
  private _lowerBound(h: number): number {
    let lo = 0;
    let hi = this._positions.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._positions[mid].hash < h) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private _insertSorted(v: VNode): void {
    const i = this._lowerBound(v.hash);
    this._positions.splice(i, 0, v);
  }
}
