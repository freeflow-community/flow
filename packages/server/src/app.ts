import Fastify, { type FastifyInstance } from 'fastify';
import { registerRoutes } from './routes/index.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  });
  registerRoutes(app);
  return app;
}
