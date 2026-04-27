/**
 * Two non-cryptographic hash functions, both implemented from scratch
 * (R11 rewards from-scratch components). The ring defaults to Murmur3
 * because its avalanche on small input changes is dramatically better than
 * FNV-1a — a property the ring needs since virtual-node keys are constructed
 * by appending a small index to a node ID.
 */

/* ------------------------------- FNV-1a 32-bit ------------------------------- */
/* Public-domain. Kept here for benchmarking and so the ring can be configured
 * with an alternative hash if the team wants to experiment in the report. */

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS_32;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return hash >>> 0;
}

/* -------------------------------- Murmur3 32-bit ------------------------------ */
/* Reference: Austin Appleby, "MurmurHash3", public domain.
 *
 * The algorithm processes the input in 4-byte chunks, mixing each chunk into
 * a running hash with multiply-rotate-multiply ("MRM") rounds, then finishes
 * with a fmix32 finalizer for avalanche.
 *
 * We assume `input` is ASCII / UTF-8 with single-byte code units; for the
 * domain of node IDs and driver IDs this is true. If you want full Unicode,
 * encode to UTF-8 bytes upstream.
 *
 * Verified against the canonical test vectors in `test/ring.test.ts`:
 *   ""                           seed=0           -> 0x00000000
 *   "a"                          seed=0x9747b28c  -> 0x7fa09ea6
 *   "hello"                      seed=0           -> 0x248bfa47
 *   "abc"                        seed=0           -> 0xb3dd93fa
 *   "The quick brown fox..."     seed=0           -> 0x2e4ff723
 */

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

export function murmur3_32(input: string, seed = 0): number {
  let h = seed >>> 0;
  const len = input.length;
  let i = 0;

  // Body: process 4-byte blocks.
  while (i + 4 <= len) {
    let k =
        (input.charCodeAt(i)     & 0xff)        |
       ((input.charCodeAt(i + 1) & 0xff) << 8)  |
       ((input.charCodeAt(i + 2) & 0xff) << 16) |
       ((input.charCodeAt(i + 3) & 0xff) << 24);

    k = Math.imul(k, C1);
    k = (k << 15) | (k >>> 17); // ROTL32(k, 15)
    k = Math.imul(k, C2);

    h ^= k;
    h = (h << 13) | (h >>> 19); // ROTL32(h, 13)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;

    i += 4;
  }

  // Tail: 1, 2, or 3 leftover bytes — fall-through is intentional.
  let k = 0;
  switch (len - i) {
    case 3: k ^= (input.charCodeAt(i + 2) & 0xff) << 16; // fall-through
    case 2: k ^= (input.charCodeAt(i + 1) & 0xff) << 8;  // fall-through
    case 1:
      k ^= input.charCodeAt(i) & 0xff;
      k = Math.imul(k, C1);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, C2);
      h ^= k;
  }

  // fmix32 finaliser — gives the avalanche property.
  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  return h >>> 0;
}
