import { Global, Module } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';

import { requiredEnv } from '../common/env';

export const KAFKA_PRODUCER = Symbol.for('KAFKA_PRODUCER');

@Global()
@Module({
  providers: [
    {
      provide: KAFKA_PRODUCER,
      useFactory: async (): Promise<Producer> => {
        const kafka = new Kafka({
          clientId: requiredEnv('KAFKA_CLIENT_ID'),
          brokers: requiredEnv('KAFKA_BROKERS').split(','),
        });
        const producer = kafka.producer({ allowAutoTopicCreation: true });
        await producer.connect();
        return producer;
      },
    },
  ],
  exports: [KAFKA_PRODUCER],
})
export class KafkaModule {}
