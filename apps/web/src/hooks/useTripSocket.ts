import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { auth } from '../api/client';

const WS_BASE = import.meta.env.VITE_WS_BASE ?? '/ws';
const WS_SOCKET_PATH = import.meta.env.VITE_WS_SOCKET_PATH;

export interface TripSocketEvent {
  type?: string;
  event?: string;
  status?: string;
  trip_id?: string;
  driver_id?: string;
  [key: string]: unknown;
}

export interface DriverLocationEvent {
  driver_id: string;
  lat: number;
  lon: number;
  heading_deg?: number;
  speed_mps?: number;
  ts?: number;
  [key: string]: unknown;
}

function wsOrigin() {
  if (/^https?:\/\//i.test(WS_BASE)) return WS_BASE;
  return window.location.origin;
}

function wsPath() {
  if (WS_SOCKET_PATH) return WS_SOCKET_PATH;
  if (/^https?:\/\//i.test(WS_BASE)) {
    const url = new URL(WS_BASE);
    const base = url.pathname.replace(/\/$/, '');
    return `${base || ''}/socket.io`;
  }
  return `${WS_BASE.replace(/\/$/, '')}/socket.io`;
}

export function isDriverLocationEvent(evt: unknown): evt is DriverLocationEvent {
  if (typeof evt !== 'object' || evt === null) return false;
  const value = evt as Partial<DriverLocationEvent>;
  return typeof value.driver_id === 'string'
    && typeof value.lat === 'number'
    && value.lat >= -90
    && value.lat <= 90
    && typeof value.lon === 'number'
    && value.lon >= -180
    && value.lon <= 180;
}

export function useTripSocket(tripId: string | null, driverId?: string | null) {
  const [events, setEvents] = useState<TripSocketEvent[]>([]);
  const [driverLocation, setDriverLocation] = useState<DriverLocationEvent | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const driverIdRef = useRef<string | null>(driverId ?? null);

  useEffect(() => {
    driverIdRef.current = driverId ?? null;
    setDriverLocation(null);
    if (socket && driverId) socket.emit('driver:subscribe', driverId);
  }, [socket, driverId]);

  useEffect(() => {
    setEvents([]);
    setDriverLocation(null);
    if (!tripId) {
      setSocket(null);
      return;
    }
    const s = io(wsOrigin(), {
      path: wsPath(),
      transports: ['websocket', 'polling'],
      auth: { token: auth.getToken() },
    });
    setSocket(s);
    s.emit('trip:subscribe', tripId);
    s.on('trip:event', (evt: TripSocketEvent) => setEvents((prev) => [...prev, evt]));
    s.on('driver:location', (evt: unknown) => {
      const currentDriverId = driverIdRef.current;
      if (!currentDriverId || !isDriverLocationEvent(evt) || evt.driver_id !== currentDriverId) return;
      setDriverLocation(evt);
    });
    return () => { s.disconnect(); setSocket(null); };
  }, [tripId]);

  return { socket, events, driverLocation };
}
