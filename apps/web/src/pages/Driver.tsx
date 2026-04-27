import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';

const INGESTOR = '/ingest/v1/locations';

export default function DriverPage() {
  const [online, setOnline] = useState(false);
  const [pos, setPos] = useState<[number, number]>([41.311, 69.279]);
  const timer = useRef<number | null>(null);

  // Demo: fake the GPS by drifting the marker by ~50 metres every 5 s.
  useEffect(() => {
    if (!online) return;
    const tick = () => {
      setPos(([lat, lon]) => [
        lat + (Math.random() - 0.5) * 0.001,
        lon + (Math.random() - 0.5) * 0.001,
      ]);
    };
    timer.current = window.setInterval(tick, 5000) as unknown as number;
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [online]);

  // POST every position to the ingestor when online
  useEffect(() => {
    if (!online) return;
    fetch(INGESTOR, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        driver_id: '00000000-0000-0000-0000-00000000e001',
        lat: pos[0], lon: pos[1],
      }),
    }).catch(() => { /* swallow demo errors */ });
  }, [pos, online]);

  return (
    <div>
      <h1>Driver</h1>
      <div className="card row">
        <button className="btn" onClick={() => setOnline((v) => !v)}>
          {online ? 'Go offline' : 'Go online'}
        </button>
        <span>Status: <b>{online ? 'online' : 'offline'}</b></span>
      </div>
      <div className="map">
        <MapContainer center={pos} zoom={14} style={{ height: '100%' }}>
          <TileLayer url={import.meta.env.VITE_MAP_TILE_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'} />
          <Marker position={pos} />
        </MapContainer>
      </div>
    </div>
  );
}
