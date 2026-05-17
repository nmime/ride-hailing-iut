import { useEffect, useMemo, useRef, useState } from 'react';
import { api, auth } from '../api/client';
import { AuthGate } from '../components/AuthGate';
import { hasYandexMapsKey, RideMap, RideMapMarker } from '../components/RideMap';
import { ActiveTripCard } from '../components/ActiveTripCard';
import { VehiclesPanel } from '../components/VehiclesPanel';
import { useToast } from '../hooks/useToast';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

const STEP = 0.001;

function yandexPointUrl(position: [number, number], zoom = 16) {
  const params = new URLSearchParams({
    ll: `${position[1]},${position[0]}`,
    z: String(zoom),
  });
  return `https://yandex.com/maps/?${params.toString()}`;
}

function parseDraftCoordinate(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '-.') return null;
  const next = Number(trimmed);
  return Number.isFinite(next) ? next : null;
}

export default function DriverPage() {
  const [online, setOnline] = useState(false);
  const [pos, setPos] = useState<[number, number]>([41.311, 69.279]);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [pingsSent, setPingsSent] = useState(0);
  const [latText, setLatText] = useState(() => '41.311000');
  const [lonText, setLonText] = useState(() => '69.279000');
  const posRef = useRef<[number, number]>(pos);
  const statusPendingRef = useRef(false);
  const watchId = useRef<number | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  // Sync displayed coords back to text fields whenever pos changes from
  // a non-text source (geolocation watch, arrow pad). The user's typing
  // is preserved because the change handler also writes latText/lonText.
  useEffect(() => {
    setLatText((cur) => (Number(cur) === pos[0] ? cur : pos[0].toFixed(6)));
    setLonText((cur) => (Number(cur) === pos[1] ? cur : pos[1].toFixed(6)));
  }, [pos]);

  useEffect(() => {
    if (!online || !navigator.geolocation) return;
    watchId.current = navigator.geolocation.watchPosition(
      (next) => setPos([next.coords.latitude, next.coords.longitude]),
      (e) => setErr(e.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    );
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
  }, [online]);

  // Single ping loop while online — independent of `pos` so React state
  // changes don't tear down and rebuild the interval on every refresh.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;

    const send = async () => {
      const session = auth.getSession();
      if (!session || cancelled) return;
      setSending(true);
      try {
        const [lat, lon] = posRef.current;
        await api.sendLocation({ driver_id: session.id, lat, lon });
        if (cancelled) return;
        setLastSentAt(new Date());
        setPingsSent((n) => n + 1);
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setSending(false);
      }
    };

    void send();
    const timer = window.setInterval(send, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [online]);

  async function toggleOnline() {
    if (statusPendingRef.current) return;
    const session = auth.getSession();
    if (!session) return;
    const next = !online;
    statusPendingRef.current = true;
    setStatusPending(true);
    setErr(null);
    try {
      await api.setDriverStatus(session.id, next ? 'online' : 'offline');
      setOnline(next);
      toast(next ? 'You are online' : 'You are offline', next ? 'success' : 'info');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      statusPendingRef.current = false;
      setStatusPending(false);
    }
  }

  function move(dLat: number, dLon: number) {
    setPos(([lat, lon]) => [lat + dLat, lon + dLon]);
  }

  const mapPos = useDebouncedValue(pos, 220);
  const driverMarkers = useMemo<RideMapMarker[]>(
    () => [
      {
        id: 'driver',
        label: online ? 'Online driver' : 'Driver',
        position: mapPos,
        tone: 'driver',
      },
    ],
    [online, mapPos],
  );

  return (
    <AuthGate role="driver">
      <div className="page driver-page stack">
        <section className="driver-hero">
          <div>
            <p className="eyebrow">Driver cockpit</p>
            <h1>Drive mode</h1>
            <p>
              Broadcast verified location, inspect the live map, and nudge coordinates during demos
              without leaving the cockpit.
            </p>
          </div>
          <div className={online ? 'driver-live-panel online' : 'driver-live-panel'}>
            <div>
              <span className="driver-live-kicker">Availability</span>
              <strong>{online ? 'Online and broadcasting' : 'Offline standby'}</strong>
              <p>
                {lastSentAt
                  ? `Last ingest ${lastSentAt.toLocaleTimeString()}`
                  : 'Location has not been sent yet.'}
              </p>
            </div>
            <button
              type="button"
              className={online ? 'btn danger' : 'btn primary'}
              onClick={toggleOnline}
              aria-pressed={online}
              aria-busy={statusPending}
              disabled={statusPending}
            >
              {online ? 'Stop broadcast' : 'Start broadcast'}
            </button>
          </div>
        </section>

        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}

        <section className="driver-cockpit-grid">
          <div className="driver-map-panel">
            <RideMap center={mapPos} zoom={14} markers={driverMarkers} />
            <div className="map-floating-panel">
              <span>Current position</span>
              <strong>
                {pos[0].toFixed(5)}, {pos[1].toFixed(5)}
              </strong>
            </div>
          </div>

          <aside className="driver-control-panel">
            <section className="driver-control-section">
              <div className="card-heading">
                <h2>Availability</h2>
                <span className={online ? 'pill success' : 'pill'}>
                  {online ? 'Broadcasting' : 'Paused'}
                </span>
              </div>
              <div className="driver-status-row">
                <div className="driver-status-indicator" aria-hidden="true">
                  <span className={online ? 'driver-signal online' : 'driver-signal'} />
                </div>
                <div>
                  <strong>{online ? 'Live ingest active' : 'Ready to go online'}</strong>
                  <p>
                    {sending
                      ? 'Sending location...'
                      : 'Pings are sent every five seconds while online.'}
                  </p>
                </div>
              </div>
              <div className="driver-stat-grid">
                <div className="driver-stat">
                  <span>Latitude</span>
                  <strong>{pos[0].toFixed(5)}</strong>
                </div>
                <div className="driver-stat">
                  <span>Longitude</span>
                  <strong>{pos[1].toFixed(5)}</strong>
                </div>
                <div className="driver-stat">
                  <span>Pings sent</span>
                  <strong>{pingsSent}</strong>
                </div>
                <div className="driver-stat">
                  <span>Last ingest</span>
                  <strong>{lastSentAt ? lastSentAt.toLocaleTimeString() : 'Not sent'}</strong>
                </div>
              </div>
            </section>

            <ActiveTripCard online={online} />

            <VehiclesPanel />

            <section className="driver-control-section">
              <div className="card-heading">
                <h2>Manual positioning</h2>
                <span className={hasYandexMapsKey() ? 'pill success' : 'pill'}>
                  {hasYandexMapsKey() ? 'Yandex ready' : 'Tashkent'}
                </span>
              </div>
              <div className="grid-2">
                <label htmlFor="driver-lat">
                  Latitude
                  <input
                    id="driver-lat"
                    inputMode="decimal"
                    value={latText}
                    onChange={(event) => {
                      setLatText(event.target.value);
                      const next = parseDraftCoordinate(event.target.value);
                      if (next !== null && next >= -90 && next <= 90)
                        setPos(([, lon]) => [next, lon]);
                    }}
                    onBlur={() => setLatText(pos[0].toFixed(6))}
                  />
                </label>
                <label htmlFor="driver-lon">
                  Longitude
                  <input
                    id="driver-lon"
                    inputMode="decimal"
                    value={lonText}
                    onChange={(event) => {
                      setLonText(event.target.value);
                      const next = parseDraftCoordinate(event.target.value);
                      if (next !== null && next >= -180 && next <= 180)
                        setPos(([lat]) => [lat, next]);
                    }}
                    onBlur={() => setLonText(pos[1].toFixed(6))}
                  />
                </label>
              </div>
              <div className="direction-pad" aria-label="Move driver location">
                <button
                  className="btn square"
                  onClick={() => move(STEP, 0)}
                  aria-label="Move north"
                >
                  ↑
                </button>
                <button
                  className="btn square"
                  onClick={() => move(0, -STEP)}
                  aria-label="Move west"
                >
                  ←
                </button>
                <button
                  className="btn square"
                  onClick={() => move(-STEP, 0)}
                  aria-label="Move south"
                >
                  ↓
                </button>
                <button className="btn square" onClick={() => move(0, STEP)} aria-label="Move east">
                  →
                </button>
              </div>
              <div className="route-card-grid compact">
                <a
                  className="route-card accent"
                  href={yandexPointUrl(pos)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>Yandex point</span>
                  <strong>
                    {pos[0].toFixed(4)}, {pos[1].toFixed(4)}
                  </strong>
                </a>
              </div>
            </section>
          </aside>
        </section>
      </div>
    </AuthGate>
  );
}
