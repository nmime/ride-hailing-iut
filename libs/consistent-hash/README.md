# `@ridex/consistent-hash` — From-scratch component (R11)

A consistent-hashing ring with virtual nodes, used by the **matcher** service
to shard live driver streams across worker replicas.

> **References.**
> Karger et al., *Consistent Hashing and Random Trees: Distributed Caching
> Protocols for Relieving Hot Spots on the World Wide Web*, STOC '97.
> Kleppmann, *Designing Data-Intensive Applications*, ch. 6 — "Partitioning by hash".
> Xu, *System Design Interview Vol. 1*, ch. 5 — "Consistent hashing".

## What it is, in two paragraphs

A consistent-hashing ring is a way to assign keys (here: `driver_id` strings)
to nodes (here: matcher replica IDs) such that **adding or removing a node
moves only ~1/N of keys**, instead of remapping every key as a naive
`hash(key) % N` would. The ring is the integer interval `[0, 2^32)`. Both
nodes and keys are hashed onto it. To route a key, walk clockwise from the
key's hash to the first node-position you meet; that node owns the key.

Each "node" is placed at *V* virtual positions (default `V = 128`). Without
virtual nodes, three real nodes might land at three points on the ring whose
arc-lengths are wildly unequal — and the unlucky node would handle 60% of
traffic. With 128 virtual positions per real node, the law of large numbers
flattens the imbalance to single-digit percent. The trade-off is memory and
build cost: O(V·N) entries, O(log(V·N)) lookup.

## Why this fits ride-hailing

The matcher service needs to:
- consume driver-location pings from Redpanda (high volume, partitioned by
  `driver_id`),
- maintain in-process state per driver (recent path, candidate trips),
- route a rider's `MATCH_REQUEST` to the worker that owns the candidate
  driver, so we don't pay a Redis round-trip per match check.

Kafka partitioning by `driver_id` already routes pings to a stable consumer.
But Kafka partition counts are sticky and painful to change online; the
consistent-hash ring lets us **reshuffle a small fraction of drivers** when
we add a matcher replica, without resetting partitions or losing per-driver
state for the other 75% of drivers.

## API

```ts
import { ConsistentHashRing } from '@ridex/consistent-hash';

const ring = new ConsistentHashRing({ vnodes: 128 });
ring.addNode('matcher-0').addNode('matcher-1').addNode('matcher-2');

const owner = ring.getNode('driver-42');   // -> 'matcher-1'
const k3   = ring.getNodes('driver-42', 3); // top-3 distinct owners
ring.removeNode('matcher-1');              // ~1/3 of drivers re-home
```

Implementation notes worth defending in viva:

- **Hash function.** Murmur3 32-bit, implemented from scratch in
  `src/hash.ts` and verified against the canonical Appleby test vectors.
  We also ship FNV-1a 32-bit and let the ring be configured with it, but
  the default is Murmur3 because FNV-1a's avalanche on near-identical
  inputs (e.g. `"matcher-0#1"` vs `"matcher-0#2"`) is poor — vnodes built
  from `nodeId#i` cluster on the ring and the load distribution drops to
  0.5×–1.5× the mean. Murmur3 + V=256 holds the load within ±10 %
  empirically.
- **Lookup.** Sorted array + binary search (`_lowerBound`). O(log V·N) per
  lookup. A treap or skiplist would give us the same amortised cost with
  faster mutation, but the matcher membership changes on the order of once
  per minute — not per request — so the simpler structure wins.
- **Wrap-around.** `_lowerBound` returns `_positions.length` when the key's
  hash exceeds every vnode's hash; we then `% length` to wrap to the
  smallest vnode (i.e. the start of the ring). Tested.

## Limitations and what we *didn't* build

- **No bounded-load variant.** Real Uber-style systems use the
  Mirrokni–Thorup–Zadimoghaddam *consistent hashing with bounded load*
  (Google, 2016) to cap any one node at e.g. 1.25× the average. We don't
  need that for the demo workload, but it's the obvious extension.
- **No replication factor enforcement.** `getNodes(key, k)` returns up to
  `k` distinct fallbacks, but the matcher only routes to the primary
  today.
- **No state migration.** When a node leaves, the matcher does *not*
  hand off in-memory state for the drivers it owned. They re-establish
  on the new owner from the Kafka partition's last committed offset.
  Acceptable because driver state is < 1 second of history.

## Tests

```
pnpm --filter @ridex/consistent-hash test
```

Tests verify:
- determinism,
- the FNV-1a 32-bit empty-string vector (`0x811c9dc5`),
- distribution within ±15 % across 4 nodes over 20 000 keys,
- removing a node remaps **only** keys previously owned by it,
  and the moved fraction is ~1/N (within 20–30 %),
- `getNodes(k)` returns `k` distinct nodes.
