import { useEffect, useState } from 'react';
import { api, CompletedFare, TripSummary } from '../api/client';
import { useToast } from '../hooks/useToast';

interface ActiveTripCardProps {
  online: boolean;
}

const REFRESH_MS = 5_000;

function mergeTrip(prev: TripSummary, next: Partial<TripSummary>): TripSummary {
  return { ...prev, ...next };
}

function fareText(result: CompletedFare) {
  const total = Number(result.total);
  const currency = result.currency ?? 'USD';
  return `${currency} ${Number.isFinite(total) ? total.toFixed(2) : String(result.total)}`;
}

function timeText(value?: string | null) {
  if (!value) return '—';
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleTimeString();
}

export function ActiveTripCard({ online }: ActiveTripCardProps) {
  const [trip, setTrip] = useState<TripSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function poll() {
      if (!online) {
        setTrip(null);
        return;
      }
      setLoading(true);
      try {
        const list = await api.listTrips({ limit: 5 });
        if (cancelled) return;
        const active =
          list.find((t) => t.status === 'matched' || t.status === 'in_progress') ?? null;
        setTrip(active);
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void poll();
    if (online) timer = window.setInterval(poll, REFRESH_MS) as unknown as number;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  async function start() {
    if (!trip) return;
    setBusy(true);
    setErr(null);
    try {
      const next = await api.startTrip(trip.id);
      setTrip(mergeTrip(trip, next));
      toast('Trip started', 'success');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!trip) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await api.completeTrip(trip.id);
      toast(`Trip completed · ${fareText(result)}`, 'success');
      setTrip(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!trip) return;
    if (!confirm('Cancel this trip?')) return;
    setBusy(true);
    setErr(null);
    try {
      await api.cancelTrip(trip.id);
      toast('Trip cancelled', 'info');
      setTrip(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="driver-control-section">
      <div className="card-heading">
        <h2>Active trip</h2>
        {trip ? (
          <span className="pill success">{trip.status}</span>
        ) : (
          <span className="pill">{online ? 'Awaiting match' : 'Offline'}</span>
        )}
      </div>

      {err && (
        <div className="error" role="alert">
          {err}
        </div>
      )}

      {!online ? (
        <p className="muted">Go online to receive trip assignments.</p>
      ) : !trip ? (
        <p className="muted">
          {loading
            ? 'Checking for assignments...'
            : 'No assigned trip yet. Stay nearby and visible.'}
        </p>
      ) : (
        <div className="active-trip stack">
          <div className="active-trip-header">
            <span>Trip {trip.id.slice(0, 8)}</span>
            <strong>
              {trip.pickup_address ?? 'Pickup'} → {trip.dropoff_address ?? 'Dropoff'}
            </strong>
          </div>
          <div className="active-trip-meta">
            <div>
              <span>Status</span>
              <strong>{trip.status}</strong>
            </div>
            <div>
              <span>Requested</span>
              <strong>{timeText(trip.requested_at)}</strong>
            </div>
          </div>
          <div className="button-row">
            {trip.status === 'matched' && (
              <button className="btn primary" onClick={start} disabled={busy} aria-busy={busy}>
                {busy ? 'Starting...' : 'Start trip'}
              </button>
            )}
            {trip.status === 'in_progress' && (
              <button className="btn primary" onClick={complete} disabled={busy} aria-busy={busy}>
                {busy ? 'Completing...' : 'Complete trip'}
              </button>
            )}
            <button className="btn ghost" onClick={cancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
