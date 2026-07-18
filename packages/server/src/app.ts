import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { registerRoutes } from './routes/index.js';
import { config } from './config.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  });
  void app.register(multipart, {
    limits: { fileSize: config.maxFileBytes, files: 1, fields: 4 },
  });
  registerRoutes(app);
  return app;
}
