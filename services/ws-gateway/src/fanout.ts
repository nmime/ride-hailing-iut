import { parseJsonMessage } from '@ridex/service-utils';
import { Server } from 'socket.io';
import { EachMessagePayload } from 'kafkajs';

export function createFanout(io: Server, topics: { location: string; trip: string }) {
  return async function fanout({ topic, message }: EachMessagePayload) {
    if (!message.value) return;

    const evt = parseJsonMessage<Record<string, unknown>>(message);
    if (!evt) return;
    if (topic === topics.trip && evt.trip_id) {
      io.to(`trip:${evt.trip_id}`).emit('trip:event', evt);
      return;
    }
    if (topic === topics.location && evt.driver_id) {
      io.to(`driver:${evt.driver_id}`).emit('driver:location', evt);
    }
  };
}
