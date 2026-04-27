import { useState } from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import { api } from '../api/client';
import { useTripSocket } from '../hooks/useTripSocket';

const TASHKENT: [number, number] = [41.311, 69.279];

export default function RiderPage() {
  const [tripId, setTripId] = useState<string | null>(null);
  const { events } = useTripSocket(tripId);

  async function requestRide() {
    const trip = await api.createTrip({
      pickup:  { lat: 41.311, lon: 69.279 },
      dropoff: { lat: 41.330, lon: 69.250 },
    });
    setTripId(trip.id);
  }

  return (
    <div>
      <h1>Rider</h1>
      <div className="card row">
        <button className="btn" onClick={requestRide} disabled={!!tripId}>
          {tripId ? `Trip ${tripId.slice(0, 8)}…` : 'Request a ride'}
        </button>
        {tripId && <span>Live updates over WebSocket — see below.</span>}
      </div>

      <div className="map">
        <MapContainer center={TASHKENT} zoom={13} style={{ height: '100%' }}>
          <TileLayer url={import.meta.env.VITE_MAP_TILE_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'} />
          <Marker position={TASHKENT} />
        </MapContainer>
      </div>

      <h3>Trip events</h3>
      <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 12, borderRadius: 8, maxHeight: 200, overflow: 'auto' }}>
        {events.map((e, i) => `${JSON.stringify(e)}\n`).join('') || '— waiting for events —'}
      </pre>
    </div>
  );
}
