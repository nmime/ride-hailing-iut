import { useEffect, useMemo, useRef, useState } from 'react';
import { api, NearbyDriver, TripSummary } from '../api/client';
import { AuthGate } from '../components/AuthGate';
import { hasYandexMapsKey, RideMap, RideMapMarker } from '../components/RideMap';
import { RatingDialog } from '../components/RatingDialog';
import { TripHistory } from '../components/TripHistory';
import { useTripSocket, type TripSocketEvent } from '../hooks/useTripSocket';
import { useToast } from '../hooks/useToast';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

const TASHKENT: [number, number] = [41.311, 69.279];
const TERMINAL_STATUSES = new Set([
  'completed',
  'cancelled_by_rider',
  'cancelled_by_driver',
  'expired',
]);

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

function eventLabel(event: TripSocketEvent | null | undefined) {
  return String(event?.type ?? event?.event ?? event?.status ?? 'trip:event');
}

function eventType(event: TripSocketEvent) {
  return String(event.type ?? event.event ?? event.status ?? '');
}

function isTerminalTrip(status?: string | null) {
  return !!status && TERMINAL_STATUSES.has(status);
}

function driverIdFromEvent(event: TripSocketEvent) {
  return typeof event.driver_id === 'string' && event.driver_id.length > 0 ? event.driver_id : null;
}

function mergeActiveTrip(
  previous: TripSummary | null,
  tripId: string | null,
  next: Partial<TripSummary>,
): TripSummary | null {
  if (!previous && !tripId) return null;
  return {
    ...(previous ?? { id: tripId!, status: 'requested', requested_at: new Date().toISOString() }),
    ...next,
  };
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

function lastSeenText(ts?: number) {
  if (!ts) return 'Live location received';
  const observed = new Date(ts);
  return Number.isNaN(observed.getTime())
    ? 'Live location received'
    : `Last seen ${observed.toLocaleTimeString()}`;
}

const STORAGE_TRIP_ID = 'ridex_active_trip_id';

export default function RiderPage() {
  const [tripId, setTripId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_TRIP_ID);
    } catch {
      return null;
    }
  });
  const [activeTrip, setActiveTrip] = useState<TripSummary | null>(null);
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
  const activeDriverId = activeTrip?.driver_id ?? null;
  const { events, driverLocation } = useTripSocket(tripId, activeDriverId);
  const { toast } = useToast();

  useEffect(() => {
    try {
      if (tripId) localStorage.setItem(STORAGE_TRIP_ID, tripId);
      else localStorage.removeItem(STORAGE_TRIP_ID);
    } catch {
      /* storage unavailable */
    }
  }, [tripId]);

  useEffect(() => {
    if (!tripId) {
      setActiveTrip(null);
      return;
    }
    let cancelled = false;
    async function restore() {
      try {
        const trip = await api.getTrip(tripId!);
        if (cancelled) return;
        if (isTerminalTrip(trip.status)) {
          setActiveTrip(null);
          setTripId(null);
          setHistoryKey((k) => k + 1);
        } else {
          setActiveTrip(trip);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setActiveTrip(null);
          setErr(`Could not restore active trip: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const handledEvents = useRef(0);
  useEffect(() => {
    if (events.length <= handledEvents.current) return;
    const newOnes = events.slice(handledEvents.current);
    handledEvents.current = events.length;
    for (const evt of newOnes) {
      const type = eventType(evt);
      const eventDriverId = driverIdFromEvent(evt);
      if (type.includes('completed')) {
        toast('Trip completed — rate your driver', 'success');
        const id = tripId;
        if (id) {
          api
            .getTrip(id)
            .then((trip) => setPendingRating(trip))
            .catch(() => {
              /* user can rate from history */
            });
        }
        setActiveTrip(null);
        setTripId(null);
        setHistoryKey((k) => k + 1);
      } else if (type.includes('cancelled') || type.includes('expired')) {
        toast('Trip cancelled', 'info');
        setActiveTrip(null);
        setTripId(null);
        setHistoryKey((k) => k + 1);
      } else if (type.includes('matched') || type.includes('accepted')) {
        setActiveTrip((trip) =>
          mergeActiveTrip(trip, tripId, {
            status: type.includes('accepted') ? 'accepted' : 'matched',
            ...(eventDriverId ? { driver_id: eventDriverId } : {}),
          }),
        );
        if (tripId)
          api
            .getTrip(tripId)
            .then(setActiveTrip)
            .catch(() => {
              /* event already updated visible state */
            });
        toast('Driver matched', 'success');
      } else if (type.includes('started') || type.includes('in_progress')) {
        setActiveTrip((trip) => mergeActiveTrip(trip, tripId, { status: 'in_progress' }));
        if (tripId)
          api
            .getTrip(tripId)
            .then(setActiveTrip)
            .catch(() => {
              /* event already updated visible state */
            });
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
  const mapPickup = useDebouncedValue(pickup, 220);
  const mapDropoff = useDebouncedValue(dropoff, 220);
  const distanceKm = useMemo(() => estimatedDistanceKm(pickup, dropoff), [pickup, dropoff]);
  const latestEvent = events.length > 0 ? events[events.length - 1] : null;
  const mapMarkers = useMemo<RideMapMarker[]>(
    () => [
      { id: 'pickup', label: 'Pickup', position: mapPickup, tone: 'pickup' },
      { id: 'dropoff', label: 'Dropoff', position: mapDropoff, tone: 'dropoff' },
      ...(nearbyDrivers ?? []).map((driver) => ({
        id: driver.driver_id,
        label: `Driver ${driver.driver_id.slice(0, 4)}`,
        position: [driver.lat, driver.lon] as [number, number],
        tone: 'nearby' as const,
      })),
      ...(driverLocation
        ? [
            {
              id: `matched-${driverLocation.driver_id}`,
              label: `Matched driver ${driverLocation.driver_id.slice(0, 4)}`,
              position: [driverLocation.lat, driverLocation.lon] as [number, number],
              tone: 'driver' as const,
            },
          ]
        : []),
    ],
    [mapPickup, mapDropoff, nearbyDrivers, driverLocation],
  );
  const routeUrl = useMemo(() => yandexRouteUrl(pickup, dropoff), [pickup, dropoff]);
  const pickupLatValid = validLat(pickupLat);
  const pickupLonValid = validLon(pickupLon);
  const dropoffLatValid = validLat(dropoffLat);
  const dropoffLonValid = validLon(dropoffLon);
  const coordinatesValid = pickupLatValid && pickupLonValid && dropoffLatValid && dropoffLonValid;
  const coordinateHintId = 'coordinate-format-hint';
  const coordinateErrorId = 'coordinate-error';
  const pickupLatDescription = `${coordinateHintId} pickup-lat-help${pickupLatValid ? '' : ` ${coordinateErrorId} pickup-lat-error`}`;
  const pickupLonDescription = `${coordinateHintId} pickup-lon-help${pickupLonValid ? '' : ` ${coordinateErrorId} pickup-lon-error`}`;
  const dropoffLatDescription = `${coordinateHintId} dropoff-lat-help${dropoffLatValid ? '' : ` ${coordinateErrorId} dropoff-lat-error`}`;
  const dropoffLonDescription = `${coordinateHintId} dropoff-lon-help${dropoffLonValid ? '' : ` ${coordinateErrorId} dropoff-lon-error`}`;
  const liveDriverCopy = activeDriverId
    ? driverLocation
      ? `${lastSeenText(driverLocation.ts)} at ${driverLocation.lat.toFixed(5)}, ${driverLocation.lon.toFixed(5)}.`
      : 'Matched driver assigned. Waiting for the next live location ping.'
    : 'Live driver tracking starts as soon as a driver is matched.';

  function fillDemoRoute() {
    setPickupLat('41.311');
    setPickupLon('69.279');
    setDropoffLat('41.330');
    setDropoffLon('69.250');
    setNearbyDrivers(null);
    setErr(null);
  }

  async function requestRide() {
    if (!coordinatesValid) {
      setErr('Enter valid pickup and dropoff coordinates before requesting a ride.');
      return;
    }
    setErr(null);
    setRequesting(true);
    try {
      const trip = await api.createTrip({
        pickup: { lat: pickup[0], lon: pickup[1] },
        dropoff: { lat: dropoff[0], lon: dropoff[1] },
        pickup_address: 'Amir Temur Square',
        dropoff_address: 'Inha University in Tashkent',
      });
      setActiveTrip(trip);
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
      setActiveTrip(null);
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
            <p>
              Set pickup and dropoff coordinates, check live driver coverage, track the matched
              driver, and subscribe to trip updates.
            </p>
          </div>
          <div className="status-tile">
            <span>Route estimate</span>
            <strong>{distanceKm.toFixed(1)} km</strong>
          </div>
        </section>

        {err && (
          <div className="error" role="alert">
            {err}
          </div>
        )}

        <section className="workflow-grid">
          <div className="stack">
            <div className="card stack trip-request-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Route builder</p>
                  <h2>Trip request</h2>
                </div>
                {tripId && <span className="pill success">Active trip</span>}
              </div>
              <div className="coordinate-card-grid">
                <section className="coordinate-card pickup" aria-labelledby="pickup-card-title">
                  <div className="coordinate-card-head">
                    <span className="coordinate-icon" aria-hidden="true">
                      A
                    </span>
                    <div>
                      <h3 id="pickup-card-title">Pickup point</h3>
                      <p>Where the rider starts. Defaults to Amir Temur Square.</p>
                    </div>
                  </div>
                  <div className="coordinate-fields">
                    <label className={pickupLatValid ? undefined : 'invalid'} htmlFor="pickup-lat">
                      Latitude
                      <input
                        id="pickup-lat"
                        value={pickupLat}
                        inputMode="decimal"
                        onChange={(event) => setPickupLat(event.target.value)}
                        aria-invalid={!pickupLatValid}
                        aria-describedby={pickupLatDescription}
                      />
                      <span id="pickup-lat-help" className="visually-hidden">
                        Pickup latitude must be between -90 and 90.
                      </span>
                      {!pickupLatValid && (
                        <span id="pickup-lat-error" className="visually-hidden">
                          Enter a pickup latitude from -90 to 90.
                        </span>
                      )}
                    </label>
                    <label className={pickupLonValid ? undefined : 'invalid'} htmlFor="pickup-lon">
                      Longitude
                      <input
                        id="pickup-lon"
                        value={pickupLon}
                        inputMode="decimal"
                        onChange={(event) => setPickupLon(event.target.value)}
                        aria-invalid={!pickupLonValid}
                        aria-describedby={pickupLonDescription}
                      />
                      <span id="pickup-lon-help" className="visually-hidden">
                        Pickup longitude must be between -180 and 180.
                      </span>
                      {!pickupLonValid && (
                        <span id="pickup-lon-error" className="visually-hidden">
                          Enter a pickup longitude from -180 to 180.
                        </span>
                      )}
                    </label>
                  </div>
                  <span className="coordinate-summary">
                    {pickup[0].toFixed(4)}, {pickup[1].toFixed(4)}
                  </span>
                </section>

                <section className="coordinate-card dropoff" aria-labelledby="dropoff-card-title">
                  <div className="coordinate-card-head">
                    <span className="coordinate-icon" aria-hidden="true">
                      B
                    </span>
                    <div>
                      <h3 id="dropoff-card-title">Dropoff point</h3>
                      <p>Destination for the route estimate. Defaults to IUT.</p>
                    </div>
                  </div>
                  <div className="coordinate-fields">
                    <label
                      className={dropoffLatValid ? undefined : 'invalid'}
                      htmlFor="dropoff-lat"
                    >
                      Latitude
                      <input
                        id="dropoff-lat"
                        value={dropoffLat}
                        inputMode="decimal"
                        onChange={(event) => setDropoffLat(event.target.value)}
                        aria-invalid={!dropoffLatValid}
                        aria-describedby={dropoffLatDescription}
                      />
                      <span id="dropoff-lat-help" className="visually-hidden">
                        Dropoff latitude must be between -90 and 90.
                      </span>
                      {!dropoffLatValid && (
                        <span id="dropoff-lat-error" className="visually-hidden">
                          Enter a dropoff latitude from -90 to 90.
                        </span>
                      )}
                    </label>
                    <label
                      className={dropoffLonValid ? undefined : 'invalid'}
                      htmlFor="dropoff-lon"
                    >
                      Longitude
                      <input
                        id="dropoff-lon"
                        value={dropoffLon}
                        inputMode="decimal"
                        onChange={(event) => setDropoffLon(event.target.value)}
                        aria-invalid={!dropoffLonValid}
                        aria-describedby={dropoffLonDescription}
                      />
                      <span id="dropoff-lon-help" className="visually-hidden">
                        Dropoff longitude must be between -180 and 180.
                      </span>
                      {!dropoffLonValid && (
                        <span id="dropoff-lon-error" className="visually-hidden">
                          Enter a dropoff longitude from -180 to 180.
                        </span>
                      )}
                    </label>
                  </div>
                  <span className="coordinate-summary">
                    {dropoff[0].toFixed(4)}, {dropoff[1].toFixed(4)}
                  </span>
                </section>
              </div>
              <p id={coordinateHintId} className="form-hint">
                Use WGS-84 coordinates: latitude −90..90, longitude −180..180.
              </p>
              {!coordinatesValid && (
                <p id={coordinateErrorId} className="form-hint warning">
                  Fix highlighted coordinates before requesting a ride or checking coverage.
                </p>
              )}
              <div className="button-row trip-actions">
                <button
                  className="btn primary"
                  onClick={requestRide}
                  disabled={!!tripId || requesting || !coordinatesValid}
                  aria-busy={requesting}
                >
                  {requesting
                    ? 'Requesting...'
                    : tripId
                      ? `Trip ${tripId.slice(0, 8)}`
                      : 'Request ride'}
                </button>
                <button
                  className="btn secondary"
                  onClick={checkCoverage}
                  disabled={checkingCoverage || !pickupLatValid || !pickupLonValid}
                  aria-busy={checkingCoverage}
                >
                  {checkingCoverage ? 'Checking...' : 'Check coverage'}
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={fillDemoRoute}
                  disabled={!!tripId}
                >
                  Demo route
                </button>
                <a className="btn ghost" href={routeUrl} target="_blank" rel="noreferrer">
                  Yandex route
                </a>
                {tripId && (
                  <button className="btn ghost" onClick={cancelRide}>
                    Cancel trip
                  </button>
                )}
              </div>
            </div>

            <div className="card stack">
              <div className="card-heading">
                <h2>Yandex cards</h2>
                <span className={hasYandexMapsKey() ? 'pill success' : 'pill'}>
                  {hasYandexMapsKey() ? 'Map provider ready' : 'Route links ready'}
                </span>
              </div>
              <div className="route-card-grid">
                <a
                  className="route-card"
                  href={yandexPointUrl(pickup)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>Pickup</span>
                  <strong>
                    {pickup[0].toFixed(4)}, {pickup[1].toFixed(4)}
                  </strong>
                </a>
                <a
                  className="route-card"
                  href={yandexPointUrl(dropoff)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>Dropoff</span>
                  <strong>
                    {dropoff[0].toFixed(4)}, {dropoff[1].toFixed(4)}
                  </strong>
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
                <span className={latestEvent ? 'pill success' : 'pill'}>
                  {latestEvent ? eventLabel(latestEvent) : (activeTrip?.status ?? 'Waiting')}
                </span>
              </div>
              <div className="metric-grid">
                <div>
                  <span>Trip</span>
                  <strong>{tripId ? tripId.slice(0, 8) : 'None'}</strong>
                </div>
                <div>
                  <span>Matched driver</span>
                  <strong>{activeDriverId ? activeDriverId.slice(0, 8) : 'Waiting'}</strong>
                </div>
                <div>
                  <span>Driver pin</span>
                  <strong>
                    {driverLocation ? 'Live' : activeDriverId ? 'Subscribed' : 'Pending'}
                  </strong>
                </div>
                <div>
                  <span>Events</span>
                  <strong>{events.length}</strong>
                </div>
              </div>
              <p className="muted">{liveDriverCopy}</p>
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
                      <a
                        className="driver-card"
                        href={yandexPointUrl(position)}
                        target="_blank"
                        rel="noreferrer"
                        key={driver.driver_id}
                      >
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

        <TripHistory refreshKey={historyKey} onRate={(trip) => setPendingRating(trip)} />

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
