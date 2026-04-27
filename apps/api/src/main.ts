/**
 * RideX API entrypoint. Nest with the Fastify HTTP adapter (faster than
 * Express, native async/await pipeline, and explicitly approved by R4).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, logger: false }),
    { bufferLogs: true },
  );

  await app.register(helmet, { contentSecurityPolicy: false });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // ---------- Swagger / OpenAPI (R4, R13) ----------
  const config = new DocumentBuilder()
    .setTitle('RideX API')
    .setDescription('Ride-hailing mini-platform — REST endpoints')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addTag('auth')
    .addTag('riders')
    .addTag('drivers')
    .addTag('trips')
    .addTag('admin')
    .addTag('health')
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, doc, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`RideX API listening on :${port}, docs at /docs`, 'Bootstrap');
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
