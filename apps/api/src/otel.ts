/**
 * OpenTelemetry bootstrap. Required-loaded BEFORE main.ts so the auto
 * instrumentations can patch http/fastify/pg/redis/kafkajs at import time.
 *
 *   node --require ./dist/otel.js dist/main.js
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'ridex-api',
  traceExporter: new OTLPTraceExporter({
    url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://otel-collector:4318'}/v1/traces`,
  }),
  instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false }, // noisy
  })],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});
