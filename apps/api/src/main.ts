import 'reflect-metadata';

import { toNodeHandler } from 'better-auth/node';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import express from 'express';

import { AppModule } from './app.module.js';
import { auth } from './auth/auth.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  /**
   * Body parsing is disabled here and re-enabled below, after the auth routes.
   *
   * better-auth reads the raw request body itself. If Express has already
   * consumed the stream, every sign-in POST arrives empty and fails in a way
   * that looks like bad credentials rather than a middleware ordering bug.
   */
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: trustedOrigins.length > 0 ? trustedOrigins : true,
    credentials: true,
  });

  // Auth first, on the raw stream…
  app.use('/api/auth/*splat', toNodeHandler(auth));

  // …then JSON parsing for everything else. Sync batches can be large after a
  // long offline stretch, so the default 100kb limit is raised.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.setGlobalPrefix('api', {
    // The auth routes are mounted directly above and must not be prefixed twice.
    exclude: ['health'],
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');

  logger.log(`IronLog API listening on :${port}`);
}

void bootstrap();
