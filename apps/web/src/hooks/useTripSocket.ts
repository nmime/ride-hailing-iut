import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_BASE = import.meta.env.VITE_WS_BASE ?? '/ws';

export function useTripSocket(tripId: string | null) {
  const [events, setEvents] = useState<any[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!tripId) return;
    const s = io(WS_BASE, { path: '/socket.io', transports: ['websocket', 'polling'] });
    setSocket(s);
    s.emit('trip:subscribe', tripId);
    s.on('trip:event', (evt: any) => setEvents((prev) => [...prev, evt]));
    return () => { s.disconnect(); setSocket(null); };
  }, [tripId]);

  return { socket, events };
}
