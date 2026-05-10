import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { auth } from '../api/client';

const WS_BASE = import.meta.env.VITE_WS_BASE ?? '/ws';
const WS_SOCKET_PATH = import.meta.env.VITE_WS_SOCKET_PATH;

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

export function useTripSocket(tripId: string | null) {
  const [events, setEvents] = useState<any[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    setEvents([]);
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
    s.on('trip:event', (evt: any) => setEvents((prev) => [...prev, evt]));
    return () => { s.disconnect(); setSocket(null); };
  }, [tripId]);

  return { socket, events };
}
