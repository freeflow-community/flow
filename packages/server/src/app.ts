import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
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

  // Web client (phase2.md §7): the production build is served as static files
  // by this same process — the local deployment stays one process. In dev the
  // Vite server proxies to us instead, so a missing dist/ is fine.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    void app.register(fastifyStatic, { root: webDist, wildcard: false });
    // SPA fallback: any non-API GET renders the app shell
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/v1')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: { code: 'not_found', message: 'not found' } });
    });
    app.log.info({ webDist }, 'serving web client');
  }
  return app;
}
