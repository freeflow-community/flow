import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';

/** Accept serialized HTTP origins only; never suffix-match or trust forwarded headers. */
export function validOrigin(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === value;
  } catch { return false; }
}

export function originAllowed(origin: string | undefined, requestOrigin?: string): boolean {
  if (origin === undefined) return true; // Native/server clients still need bearer auth.
  if (!validOrigin(origin)) return false;
  return origin === requestOrigin || origin === new URL(config.webUrlBase).origin ||
    config.allowedWebOrigins.some(value => validOrigin(value) && value === origin);
}

const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const headers = ['authorization', 'content-type', 'range'];

export function registerBrowserPolicy(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Vary', 'Origin');
    const origin = req.headers.origin;
    if (!originAllowed(origin, `${req.protocol}://${req.headers.host}`)) {
      return reply.code(403).send({ error: { code: 'origin_not_allowed', message: 'Browser origin is not allowed; ask the operator to configure FLOW_ALLOWED_WEB_ORIGINS' } });
    }
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Range, Accept-Ranges');
      // Deliberately no Access-Control-Allow-Credentials: cross-origin sessions use bearer tokens.
    }
    if (req.method !== 'OPTIONS' || !origin) return;
    const method = req.headers['access-control-request-method'];
    const requested = String(req.headers['access-control-request-headers'] ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
    reply.header('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
    if (typeof method !== 'string' || !methods.includes(method) || requested.some(v => !headers.includes(v))) {
      return reply.code(403).send({ error: { code: 'preflight_not_allowed', message: 'Unsupported browser request method or headers' } });
    }
    return reply.header('Access-Control-Allow-Methods', methods.join(', '))
      .header('Access-Control-Allow-Headers', headers.join(', ')).code(204).send();
  });
  app.options('/*', async (_req, reply) => reply.code(204).send());
}
