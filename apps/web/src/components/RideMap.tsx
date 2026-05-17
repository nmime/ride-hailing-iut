import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';

export type LatLon = [number, number];
export type RideMapMarkerTone = 'pickup' | 'dropoff' | 'driver' | 'nearby';

export interface RideMapMarker {
  id: string;
  label: string;
  position: LatLon;
  tone?: RideMapMarkerTone;
}

interface RideMapProps {
  center: LatLon;
  zoom: number;
  markers: RideMapMarker[];
}

interface YandexMapsApi {
  ready: Promise<void>;
  YMap: new (...args: any[]) => any;
  YMapDefaultSchemeLayer: new (...args: any[]) => any;
  YMapDefaultFeaturesLayer: new (...args: any[]) => any;
  YMapMarker: new (...args: any[]) => any;
}

declare global {
  interface Window {
    ymaps3?: YandexMapsApi;
  }
}

const YANDEX_SCRIPT_ID = 'ridex-yandex-maps-api';
let yandexMapsPromise: Promise<YandexMapsApi> | null = null;

const MAP_LEGEND: Array<{ tone: RideMapMarkerTone; label: string }> = [
  { tone: 'pickup', label: 'Pickup' },
  { tone: 'dropoff', label: 'Dropoff' },
  { tone: 'driver', label: 'Driver' },
  { tone: 'nearby', label: 'Nearby' },
];

function toneLabel(tone: RideMapMarkerTone | undefined) {
  return MAP_LEGEND.find((item) => item.tone === (tone ?? 'nearby'))?.label ?? 'Marker';
}

function coordinateText(position: LatLon) {
  return `${position[0].toFixed(5)}, ${position[1].toFixed(5)}`;
}

function MapLegend() {
  return (
    <div className="map-legend" aria-label="Map marker legend">
      {MAP_LEGEND.map((item) => (
        <span key={item.tone}>
          <i className={`map-legend-dot map-legend-${item.tone}`} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function env(name: string) {
  return String(import.meta.env[name] ?? '').trim();
}

export function hasYandexMapsKey() {
  return env('VITE_YANDEX_MAPS_API_KEY').length > 0;
}

function shouldUseYandex() {
  const provider = env('VITE_MAP_PROVIDER').toLowerCase();
  return hasYandexMapsKey() && (provider === 'yandex' || provider === 'auto' || provider === '');
}

function toLngLat(position: LatLon) {
  return [position[1], position[0]];
}

/** Stable identity for a center: only update the map when lat/lon changes
 *  by at least one ten-thousandth (~10 m). Typing a sixth decimal place
 *  doesn't move the camera. */
function centerKey(center: LatLon) {
  return `${center[0].toFixed(4)},${center[1].toFixed(4)}`;
}

/** Stable identity for a marker set so map effects don't re-fire when
 *  React happens to allocate a new array literal each render. */
function markerKey(markers: RideMapMarker[]) {
  return markers
    .map(
      (m) =>
        `${m.id}:${m.position[0].toFixed(5)}:${m.position[1].toFixed(5)}:${m.tone ?? ''}:${m.label}`,
    )
    .join('|');
}

function loadYandexMaps() {
  if (window.ymaps3) return Promise.resolve(window.ymaps3);
  if (yandexMapsPromise) return yandexMapsPromise;

  yandexMapsPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(YANDEX_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    const lang = env('VITE_YANDEX_MAPS_LANG') || 'en_US';
    const apikey = encodeURIComponent(env('VITE_YANDEX_MAPS_API_KEY'));

    script.id = YANDEX_SCRIPT_ID;
    script.async = true;
    script.src = `https://api-maps.yandex.ru/v3/?apikey=${apikey}&lang=${encodeURIComponent(lang)}`;
    script.onload = async () => {
      try {
        if (!window.ymaps3) throw new Error('Yandex Maps API did not expose ymaps3');
        await window.ymaps3.ready;
        resolve(window.ymaps3);
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = () => reject(new Error('Yandex Maps API failed to load'));

    if (!existing) document.head.appendChild(script);
  });

  return yandexMapsPromise;
}

function createYandexMarkerElement(marker: RideMapMarker) {
  const root = document.createElement('div');
  root.className = `yandex-marker yandex-marker-${marker.tone ?? 'nearby'}`;
  root.setAttribute('aria-label', marker.label);

  const dot = document.createElement('span');
  dot.className = 'yandex-marker-dot';
  const text = document.createElement('strong');
  text.textContent = marker.label;

  root.append(dot, text);
  return root;
}

/* ----------------------------- Leaflet ----------------------------- */

function LeafletViewport({
  centerKey: key,
  center,
  zoom,
}: {
  centerKey: string;
  center: LatLon;
  zoom: number;
}) {
  const map = useMap();
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (lastKey.current === key) return;
    const isFirst = lastKey.current === null;
    lastKey.current = key;
    map.setView(center, zoom, { animate: !isFirst });
  }, [key, map, center, zoom]);

  useEffect(() => {
    const refresh = () => map.invalidateSize();
    const observer = new ResizeObserver(refresh);
    const t = window.setTimeout(refresh, 80);
    observer.observe(map.getContainer());
    window.addEventListener('resize', refresh);
    return () => {
      window.clearTimeout(t);
      observer.disconnect();
      window.removeEventListener('resize', refresh);
    };
  }, [map]);

  return null;
}

const ICON_BY_TONE: Record<string, L.DivIcon> = {};
function leafletIconFor(tone: RideMapMarkerTone | undefined) {
  const key = tone ?? 'nearby';
  if (ICON_BY_TONE[key]) return ICON_BY_TONE[key];
  const icon = L.divIcon({
    className: `leaflet-pin leaflet-pin-${key}`,
    html: '<span class="pin-dot"></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
  ICON_BY_TONE[key] = icon;
  return icon;
}

function LeafletRideMap({ center, markers, zoom }: RideMapProps) {
  const cKey = useMemo(() => centerKey(center), [center]);

  return (
    <>
      <MapContainer center={center} zoom={zoom} style={{ height: '100%' }} preferCanvas>
        <LeafletViewport centerKey={cKey} center={center} zoom={zoom} />
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url={
            import.meta.env.VITE_MAP_TILE_URL ??
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
          }
        />
        {markers.map((marker) => (
          <Marker key={marker.id} position={marker.position} icon={leafletIconFor(marker.tone)}>
            <Tooltip
              permanent
              direction="top"
              offset={[0, -12]}
              className={`leaflet-label leaflet-label-${marker.tone ?? 'nearby'}`}
            >
              {marker.label}
            </Tooltip>
            <Popup>
              <strong>{marker.label}</strong>
              <span className="popup-kicker">{toneLabel(marker.tone)}</span>
              <span>{coordinateText(marker.position)}</span>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <span className="map-provider-badge">OpenStreetMap</span>
      <MapLegend />
    </>
  );
}

/* ----------------------------- Yandex ------------------------------ */

function YandexRideMap({ center, markers, zoom }: RideMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerNodes = useRef<Map<string, any>>(new Map());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const cKey = useMemo(() => centerKey(center), [center]);
  const mKey = useMemo(() => markerKey(markers), [markers]);

  // Mount / unmount map exactly once.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    (async () => {
      if (!containerRef.current) return;
      try {
        const ymaps3 = await loadYandexMaps();
        if (cancelled || !containerRef.current) return;

        const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer } = ymaps3;
        containerRef.current.innerHTML = '';
        mapRef.current = new YMap(
          containerRef.current,
          {
            location: { center: toLngLat(center), zoom },
            showScaleInCopyrights: true,
          },
          [new YMapDefaultSchemeLayer({}), new YMapDefaultFeaturesLayer({})],
        );
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (mapRef.current?.destroy) {
        try {
          mapRef.current.destroy();
        } catch {
          /* ignore */
        }
      }
      mapRef.current = null;
      markerNodes.current.clear();
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
    // Intentionally empty: only mount once. center/zoom are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pan / zoom without remounting.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.update || status !== 'ready') return;
    try {
      map.update({ location: { center: toLngLat(center), zoom, duration: 250 } });
    } catch {
      /* yandex throws if location malformed; ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cKey, zoom, status]);

  // Diff markers in place — add new, move existing, drop removed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !window.ymaps3) return;
    const { YMapMarker } = window.ymaps3;

    const seen = new Set<string>();
    for (const m of markers) {
      seen.add(m.id);
      const existing = markerNodes.current.get(m.id);
      if (existing) {
        // Yandex YMapMarker exposes `update` to move without recreating.
        if (typeof existing.update === 'function') {
          try {
            existing.update({ coordinates: toLngLat(m.position) });
          } catch {
            /* ignore */
          }
        }
      } else {
        const node = new YMapMarker(
          { coordinates: toLngLat(m.position), disableRoundCoordinates: true },
          createYandexMarkerElement(m),
        );
        map.addChild(node);
        markerNodes.current.set(m.id, node);
      }
    }
    for (const [id, node] of markerNodes.current) {
      if (!seen.has(id)) {
        try {
          map.removeChild(node);
        } catch {
          /* ignore */
        }
        markerNodes.current.delete(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mKey, status]);

  if (status === 'error') return <LeafletRideMap center={center} markers={markers} zoom={zoom} />;

  return (
    <>
      <div className="yandex-map" ref={containerRef} />
      <span className="map-provider-badge">
        {status === 'ready' ? 'Yandex Maps' : 'Loading Yandex'}
      </span>
    </>
  );
}

export function RideMap(props: RideMapProps) {
  if (shouldUseYandex()) return <YandexRideMap {...props} />;
  return <LeafletRideMap {...props} />;
}
