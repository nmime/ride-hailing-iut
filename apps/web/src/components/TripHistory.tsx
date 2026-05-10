import { useEffect, useState } from 'react';
import { api, TripSummary } from '../api/client';

interface TripHistoryProps {
  refreshKey: number;
  onRate?: (trip: TripSummary) => void;
}

export function TripHistory({ refreshKey, onRate }: TripHistoryProps) {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true); setErr(null);
    try {
      setTrips(await api.listTrips({ limit: 10 }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [refreshKey]);

  return (
    <div className="card stack">
      <div className="card-heading">
        <h2>Recent trips</h2>
        <button className="btn ghost" onClick={refresh} disabled={loading} aria-busy={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      {trips.length === 0 ? (
        <p className="muted">{loading ? 'Loading recent trips...' : 'No trips yet.'}</p>
      ) : (
        <div className="trip-history">
          {trips.map((t) => (
            <div className="trip-history-row" key={t.id}>
              <div>
                <strong>{t.pickup_address ?? 'Pickup'} → {t.dropoff_address ?? 'Dropoff'}</strong>
                <span className="muted">
                  {new Date(t.requested_at).toLocaleString()} · {t.status}
                </span>
              </div>
              <div className="trip-history-side">
                {t.fare_total !== null && t.fare_total !== undefined ? (
                  <strong>{t.currency ?? '$'} {Number(t.fare_total).toFixed(2)}</strong>
                ) : (
                  <span className="muted">No fare yet</span>
                )}
                {t.status === 'completed' && onRate && (
                  <button type="button" className="btn ghost" onClick={() => onRate(t)}>
                    Rate
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
