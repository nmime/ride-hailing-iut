import { useEffect, useMemo, useRef, useState } from 'react';
import { api, NearbyDriver, TripSummary } from '../api/client';
import { AuthGate } from '../components/AuthGate';
import { hasYandexMapsKey, RideMap, RideMapMarker } from '../components/RideMap';
import { RatingDialog } from '../components/RatingDialog';
import { TripHistory } from '../components/TripHistory';
import { useTripSocket } from '../hooks/useTripSocket';
import { useToast } from '../hooks/useToast';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

const TASHKENT: [number, number] = [41.311, 69.279];

function toCoordinate(value: string, fallback: number) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '-.') return fallback;
  const next = Number(trimmed);
  return Number.isFinite(next) ? next : fallback;
}

function parseCoordinate(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '-.') return null;
  const next = Number(trimmed);
  return Number.isFinite(next) ? next : null;
}

function validLat(value: string) {
  const n = parseCoordinate(value);
  return n !== null && n >= -90 && n <= 90;
}

function validLon(value: string) {
  const n = parseCoordinate(value);
  return n !== null && n >= -180 && n <= 180;
}

function estimatedDistanceKm(pickup: [number, number], dropoff: [number, number]) {
  const latKm = (dropoff[0] - pickup[0]) * 111;
  const lonKm = (dropoff[1] - pickup[1]) * 111 * Math.cos((pickup[0] * Math.PI) / 180);
  return Math.max(0.1, Math.hypot(latKm, lonKm));
}

function eventLabel(event: any) {
  return String(event?.type ?? event?.event ?? event?.status ?? 'trip:event');
}

function yandexRouteUrl(pickup: [number, number], dropoff: [number, number]) {
  const params = new URLSearchParams({
    rtext: `${pickup[0]},${pickup[1]}~${dropoff[0]},${dropoff[1]}`,
    rtt: 'auto',
  });
  return `https://yandex.com/maps/?${params.toString()}`;
}

function yandexPointUrl(position: [number, number], zoom = 16) {
  const params = new URLSearchParams({
    ll: `${position[1]},${position[0]}`,
    z: String(zoom),
  });
  return `https://yandex.com/maps/?${params.toString()}`;
}

const STORAGE_TRIP_ID = 'ridex_active_trip_id';

export default function RiderPage() {
  const [tripId, setTripId] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_TRIP_ID); } catch { return null; }
  });
  const [pickupLat, setPickupLat] = useState('41.311');
  const [pickupLon, setPickupLon] = useState('69.279');
  const [dropoffLat, setDropoffLat] = useState('41.330');
  const [dropoffLon, setDropoffLon] = useState('69.250');
  const [err, setErr] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [checkingCoverage, setCheckingCoverage] = useState(false);
  const [nearbyDrivers, setNearbyDrivers] = useState<NearbyDriver[] | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [pendingRating, setPendingRating] = useState<TripSummary | null>(null);
  const { events } = useTripSocket(tripId);
  const { toast } = useToast();

  useEffect(() => {
    try {
      if (tripId) localStorage.setItem(STORAGE_TRIP_ID, tripId);
      else localStorage.removeItem(STORAGE_TRIP_ID);
    } catch { /* storage unavailable */ }
  }, [tripId]);

  const handledEvents = useRef(0);
  useEffect(() => {
    if (events.length <= handledEvents.current) return;
    const newOnes = events.slice(handledEvents.current);
    handledEvents.current = events.length;
    for (const evt of newOnes) {
      const type = String(evt?.type ?? evt?.event ?? '');
      if (type.includes('completed')) {
        toast('Trip completed — rate your driver', 'success');
        const id = tripId;
        if (id) {
          api.getTrip(id)
            .then((trip) => setPendingRating(trip))
            .catch(() => { /* user can rate from history */ });
        }
        setTripId(null);
        setHistoryKey((k) => k + 1);
      } else if (type.includes('cancelled')) {
        toast('Trip cancelled', 'info');
        setTripId(null);
        setHistoryKey((k) => k + 1);
      } else if (type.includes('matched')) {
        toast('Driver matched', 'success');
      } else if (type.includes('started')) {
        toast('Trip started', 'info');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);
  useEffect(() => {
    if (!tripId) handledEvents.current = 0;
  }, [tripId]);
  const pickup = useMemo<[number, number]>(
    () => [toCoordinate(pickupLat, TASHKENT[0]), toCoordinate(pickupLon, TASHKENT[1])],
    [pickupLat, pickupLon],
  );
  const dropoff = useMemo<[number, number]>(
    () => [toCoordinate(dropoffLat, TASHKENT[0]), toCoordinate(dropoffLon, TASHKENT[1])],
    [dropoffLat, dropoffLon],
  );

  // Map effects (re-center, marker re-build) are throttled to settled
  // input so typing stays smooth.
  const mapPickup  = useDebouncedValue(pickup,  220);
  const mapDropoff = useDebouncedValue(dropoff, 220);
  const distanceKm = useMemo(() => estimatedDistanceKm(pickup, dropoff), [pickup, dropoff]);
  const latestEvent = events.length > 0 ? events[events.length - 1] : null;
  const mapMarkers = useMemo<RideMapMarker[]>(() => [
    { id: 'pickup',  label: 'Pickup',  position: mapPickup,  tone: 'pickup' },
    { id: 'dropoff', label: 'Dropoff', position: mapDropoff, tone: 'dropoff' },
    ...(nearbyDrivers ?? []).map((driver) => ({
      id: driver.driver_id,
      label: `Driver ${driver.driver_id.slice(0, 4)}`,
      position: [driver.lat, driver.lon] as [number, number],
      tone: 'nearby' as const,
    })),
  ], [mapPickup, mapDropoff, nearbyDrivers]);
  const routeUrl = useMemo(() => yandexRouteUrl(pickup, dropoff), [pickup, dropoff]);
  const coordinatesValid =
    validLat(pickupLat) && validLon(pickupLon) &&
    validLat(dropoffLat) && validLon(dropoffLon);

  async function requestRide() {
    if (!coordinatesValid) {
      setErr('Enter valid pickup and dropoff coordinates before requesting a ride.');
      return;
    }
    setErr(null);
    setRequesting(true);
    try {
      const trip = await api.createTrip({
        pickup:  { lat: pickup[0], lon: pickup[1] },
        dropoff: { lat: dropoff[0], lon: dropoff[1] },
        pickup_address: 'Amir Temur Square',
        dropoff_address: 'Inha University in Tashkent',
      });
      setTripId(trip.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRequesting(false);
    }
  }

  async function checkCoverage() {
    if (!validLat(pickupLat) || !validLon(pickupLon)) {
      setErr('Enter a valid pickup coordinate before checking coverage.');
      return;
    }
    setErr(null);
    setCheckingCoverage(true);
    try {
      const drivers = await api.nearby(pickup[1], pickup[0], 3000);
      setNearbyDrivers(drivers);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingCoverage(false);
    }
  }

  async function cancelRide() {
    if (!tripId) return;
    setErr(null);
    try {
      await api.cancelTrip(tripId);
      toast('Trip cancelled', 'info');
      setTripId(null);
      setHistoryKey((k) => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function submitRating(rating: number, comment?: string) {
    if (!pendingRating) return;
    await api.rateTrip(pendingRating.id, { rating, comment });
    toast(`Thanks — ${rating}-star rating submitted`, 'success');
    setPendingRating(null);
    setHistoryKey((k) => k + 1);
  }

  return (
    <AuthGate role="rider">
      <div className="page stack">
        <section className="page-header">
          <div>
            <p className="eyebrow">Rider console</p>
            <h1>Book a ride in Tashkent</h1>
            <p>Set pickup and dropoff coordinates, check live driver coverage, and subscribe to trip updates.</p>
          </div>
          <div className="status-tile">
            <span>Route estimate</span>
            <strong>{distanceKm.toFixed(1)} km</strong>
          </div>
        </section>

        {err && <div className="error" role="alert">{err}</div>}

        <section className="workflow-grid">
          <div className="stack">
            <div className="card stack">
              <div className="card-heading">
                <h2>Trip request</h2>
                {tripId && <span className="pill success">Active trip</span>}
              </div>
              <div className="grid-4">
                <label htmlFor="pickup-lat">Pickup lat<input id="pickup-lat" value={pickupLat} inputMode="decimal" onChange={(event) => setPickupLat(event.target.value)} /></label>
                <label htmlFor="pickup-lon">Pickup lon<input id="pickup-lon" value={pickupLon} inputMode="decimal" onChange={(event) => setPickupLon(event.target.value)} /></label>
                <label htmlFor="dropoff-lat">Dropoff lat<input id="dropoff-lat" value={dropoffLat} inputMode="decimal" onChange={(event) => setDropoffLat(event.target.value)} /></label>
                <label htmlFor="dropoff-lon">Dropoff lon<input id="dropoff-lon" value={dropoffLon} inputMode="decimal" onChange={(event) => setDropoffLon(event.target.value)} /></label>
              </div>
              {!coordinatesValid && (
                <p className="form-hint warning">Use WGS-84 coordinates: latitude −90..90, longitude −180..180.</p>
              )}
              <div className="button-row">
                <button className="btn primary" onClick={requestRide} disabled={!!tripId || requesting || !coordinatesValid} aria-busy={requesting}>
                  {requesting ? 'Requesting...' : tripId ? `Trip ${tripId.slice(0, 8)}` : 'Request ride'}
                </button>
                <button className="btn secondary" onClick={checkCoverage} disabled={checkingCoverage || !validLat(pickupLat) || !validLon(pickupLon)} aria-busy={checkingCoverage}>
                  {checkingCoverage ? 'Checking...' : 'Check coverage'}
                </button>
                <a className="btn ghost" href={routeUrl} target="_blank" rel="noreferrer">Yandex route</a>
                {tripId && <button className="btn ghost" onClick={cancelRide}>Cancel trip</button>}
              </div>
            </div>

            <div className="card stack">
              <div className="card-heading">
                <h2>Yandex cards</h2>
                <span className={hasYandexMapsKey() ? 'pill success' : 'pill'}>{hasYandexMapsKey() ? 'Map provider ready' : 'Route links ready'}</span>
              </div>
              <div className="route-card-grid">
                <a className="route-card" href={yandexPointUrl(pickup)} target="_blank" rel="noreferrer">
                  <span>Pickup</span>
                  <strong>{pickup[0].toFixed(4)}, {pickup[1].toFixed(4)}</strong>
                </a>
                <a className="route-card" href={yandexPointUrl(dropoff)} target="_blank" rel="noreferrer">
                  <span>Dropoff</span>
                  <strong>{dropoff[0].toFixed(4)}, {dropoff[1].toFixed(4)}</strong>
                </a>
                <a className="route-card accent" href={routeUrl} target="_blank" rel="noreferrer">
                  <span>Route</span>
                  <strong>{distanceKm.toFixed(1)} km estimate</strong>
                </a>
              </div>
            </div>

            <div className="card stack">
              <div className="card-heading">
                <h2>Live status</h2>
                <span className={latestEvent ? 'pill success' : 'pill'}>{latestEvent ? eventLabel(latestEvent) : 'Waiting'}</span>
              </div>
              <div className="metric-grid">
                <div>
                  <span>Trip</span>
                  <strong>{tripId ? tripId.slice(0, 8) : 'None'}</strong>
                </div>
                <div>
                  <span>Driver coverage</span>
                  <strong>{nearbyDrivers === null ? 'Unchecked' : nearbyDrivers.length}</strong>
                </div>
                <div>
                  <span>Events</span>
                  <strong>{events.length}</strong>
                </div>
              </div>
              {nearbyDrivers !== null && (
                <p className="muted">
                  {nearbyDrivers.length > 0
                    ? `${nearbyDrivers.length} driver${nearbyDrivers.length === 1 ? '' : 's'} found within 3 km.`
                    : 'No online drivers found within 3 km of pickup.'}
                </p>
              )}
              {nearbyDrivers !== null && nearbyDrivers.length > 0 && (
                <div className="driver-card-list">
                  {nearbyDrivers.slice(0, 5).map((driver) => {
                    const position: [number, number] = [driver.lat, driver.lon];
                    const driverDistanceKm = estimatedDistanceKm(pickup, position);
                    return (
                      <a className="driver-card" href={yandexPointUrl(position)} target="_blank" rel="noreferrer" key={driver.driver_id}>
                        <span>{driver.driver_id.slice(0, 8)}</span>
                        <strong>{driverDistanceKm.toFixed(1)} km away</strong>
                      </a>
                    );
                  })}
                </div>
              )}
              <div className="event-feed" aria-live="polite">
                {events.length === 0 ? (
                  <span className="muted">Waiting for websocket trip events.</span>
                ) : (
                  events.slice(-5).map((event, index) => (
                    <div className="event-row" key={`${eventLabel(event)}-${index}`}>
                      <span>{eventLabel(event)}</span>
                      <code>{JSON.stringify(event)}</code>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="card map-card">
            <RideMap center={mapPickup} zoom={13} markers={mapMarkers} />
          </div>
        </section>

        <TripHistory
          refreshKey={historyKey}
          onRate={(trip) => setPendingRating(trip)}
        />

        {pendingRating && (
          <RatingDialog
            tripId={pendingRating.id}
            onSubmit={submitRating}
            onDismiss={() => setPendingRating(null)}
          />
        )}
      </div>
    </AuthGate>
  );
}
