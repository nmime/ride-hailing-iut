import { Pool } from 'pg';
import pino from 'pino';
import { Server } from 'socket.io';

import { JwtPayload, verifyJwt } from './auth';
import { canSubscribeToDriver, canSubscribeToTrip } from './authorization';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module 'socket.io' {
  interface Socket {
    user?: JwtPayload;
  }
}

export function registerSocketHandlers(io: Server, pg: Pool, jwtSecret: string, log: pino.Logger) {
  io.use((sock, next) => {
    const authToken = sock.handshake.auth?.token;
    const header = sock.handshake.headers.authorization;
    const token =
      typeof authToken === 'string'
        ? authToken
        : typeof header === 'string' && header.startsWith('Bearer ')
          ? header.slice(7)
          : null;

    if (!token) return next(new Error('missing bearer token'));
    try {
      sock.user = verifyJwt(token, jwtSecret);
      return next();
    } catch {
      return next(new Error('invalid token'));
    }
  });

  io.on('connection', (sock) => {
    log.info({ id: sock.id }, 'ws connected');

    sock.on('trip:subscribe', async (tripId: string) => {
      if (!UUID_RE.test(tripId)) {
        sock.emit('trip:error', { code: 'bad_trip_id' });
        return;
      }
      if (!(await canSubscribeToTrip(pg, sock.user!, tripId))) {
        sock.emit('trip:error', { code: 'forbidden' });
        return;
      }
      await sock.join(`trip:${tripId}`);
      log.debug({ id: sock.id, tripId, user: sock.user!.sub }, 'joined trip room');
    });

    sock.on('driver:subscribe', async (driverId: string) => {
      if (!UUID_RE.test(driverId)) {
        sock.emit('driver:error', { code: 'bad_driver_id' });
        return;
      }
      if (!(await canSubscribeToDriver(pg, sock.user!, driverId))) {
        sock.emit('driver:error', { code: 'forbidden' });
        return;
      }
      await sock.join(`driver:${driverId}`);
    });

    sock.on('disconnect', () => log.info({ id: sock.id }, 'ws disconnected'));
  });
}
