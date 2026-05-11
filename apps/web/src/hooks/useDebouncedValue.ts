import { useEffect, useState } from 'react';

/**
 * Returns a deferred copy of `value` that only updates after `delayMs`
 * with no further changes. Useful for keeping the visible input snappy
 * while still throttling expensive downstream effects (map re-centers,
 * API queries, etc.).
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}
