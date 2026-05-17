import { useEffect, useState } from 'react';
import { api, auth, Me } from '../api/client';

interface UseMeResult {
  me: Me | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMe(): UseMeResult {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!auth.getSession()) {
      setMe(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setMe(await api.me());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (auth.getSession()) {
      void (async () => {
        try {
          const next = await api.me();
          if (!cancelled) setMe(next);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }
    const off = auth.subscribe(() => {
      if (!auth.getSession()) setMe(null);
      else void refresh();
    });
    return () => {
      cancelled = true;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { me, loading, error, refresh };
}
