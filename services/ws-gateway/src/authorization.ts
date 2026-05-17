import { Pool } from 'pg';
import { JwtPayload } from '@ridex/service-utils';

export async function canSubscribeToTrip(
  pg: Pool,
  user: JwtPayload,
  tripId: string,
): Promise<boolean> {
  if (user.role === 'admin') return true;
  const { rows } = await pg.query<{ rider_id: string; driver_id: string | null }>(
    `SELECT rider_id, driver_id FROM trips WHERE id = $1`,
    [tripId],
  );
  const trip = rows[0];
  if (!trip) return false;
  return trip.rider_id === user.sub || trip.driver_id === user.sub;
}

export async function canSubscribeToDriver(
  pg: Pool,
  user: JwtPayload,
  driverId: string,
): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (user.role === 'driver') return user.sub === driverId;
  const { rowCount } = await pg.query(
    `SELECT 1
       FROM trips
      WHERE rider_id = $1
        AND driver_id = $2
        AND status IN ('matched', 'in_progress')
      LIMIT 1`,
    [user.sub, driverId],
  );
  return (rowCount ?? 0) > 0;
}
