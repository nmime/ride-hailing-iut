import { ConsistentHashRing } from '@ridex/consistent-hash';
import { parseJsonMessage } from '@ridex/service-utils';
import { EachMessagePayload } from 'kafkajs';
import pino from 'pino';

export function buildReplicaRing(replicas: string[], vnodes: number, log: pino.Logger) {
  const ring = new ConsistentHashRing({ vnodes });
  replicas.forEach((replica) => ring.addNode(replica));
  log.info({ replicas: ring.nodes }, 'consistent-hash ring built');
  return ring;
}

export function createLocationHandler(ring: ConsistentHashRing, selfId: string, log: pino.Logger) {
  return async function handleLocation({ message }: EachMessagePayload) {
    if (!message.value || !message.key) return;

    const driverId = message.key.toString();
    if (ring.getNode(driverId) !== selfId) return;

    const ping = parseJsonMessage(message, log, { topic: 'driver.location', driverId });
    if (!ping) return;
    log.debug({ driverId, ping }, 'loc');
  };
}
