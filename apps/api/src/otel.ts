/**
 * OpenTelemetry bootstrap. Required-loaded BEFORE main.ts so the auto
 * instrumentations can patch http/fastify/pg/redis/kafkajs at import time.
 *
 *   node --require ./dist/otel.js dist/main.js
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

const sdk = new NodeSDK({
  serviceName: requiredEnv('OTEL_SERVICE_NAME'),
  traceExporter: new OTLPTraceExporter({
    url: `${requiredEnv('OTEL_EXPORTER_OTLP_ENDPOINT')}/v1/traces`,
  }),
  instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false }, // noisy
  })],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});
