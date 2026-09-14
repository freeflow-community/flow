import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Fault } from './connector.js';

export function createConnectorServer(connector) {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const respond = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const path = new URL(req.url, connector.publicOrigin).pathname;
      const origin = req.headers.origin;
      if (origin && !connector.clientOrigins.includes(origin)) throw new Fault('client_origin_not_allowed', 403);
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        // Retry-After is not CORS-safelisted; without this a browser client
        // sees a 429 but not the wait, and would have to guess.
        res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (path === '/oauth/callback' && req.method === 'GET') {
        const params = new URL(req.url, connector.publicOrigin).searchParams;
        for (const key of ['state', 'code', 'error']) if (params.getAll(key).length > 1) throw new Fault('invalid_callback');
        const result = await connector.callback(Object.fromEntries(params));
        // A native client's authorization ends by returning to its URL scheme
        // (#546). Only the operation id travels in the URL; the handoff is
        // redeemed by polling with the private verifier, as on the web.
        if (connector.isNativeOrigin(result.clientOrigin)) {
          res.writeHead(302, { location: `${result.clientOrigin}/connected?operationId=${encodeURIComponent(result.operationId)}` });
          res.end();
          return;
        }
        const nonce = randomBytes(18).toString('base64');
        res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        const data = JSON.stringify({ type: 'flow-slack-handoff', operationId: result.operationId, handoff: result.handoff }).replace(/</g, '\\u003c');
        const target = JSON.stringify(result.clientOrigin).replace(/</g, '\\u003c');
        res.end(`<!doctype html><title>Slack authorization</title><p>Authorization returned. You can close this window.</p><script nonce="${nonce}">history.replaceState(null,'','/oauth/callback');if(window.opener)window.opener.postMessage(${data},${target});</script>`);
        return;
      }
      let raw = Buffer.alloc(0);
      for await (const chunk of req) {
        if (raw.length + chunk.length > 64 * 1024) throw new Fault('body_too_large', 413);
        raw = Buffer.concat([raw, chunk]);
      }
      if (path === '/slack/events' && req.method === 'POST') { respond(200, connector.event(raw, req.headers['x-slack-request-timestamp'], req.headers['x-slack-signature'])); return; }
      let body = {};
      if (raw.length) {
        if (!req.headers['content-type']?.startsWith('application/json')) throw new Fault('json_required', 415);
        try { body = JSON.parse(raw.toString()); } catch { throw new Fault('invalid_json'); }
        if (!body || Array.isArray(body) || typeof body !== 'object') throw new Fault('invalid_json');
      }
      const credential = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
      if (path === '/health' && req.method === 'GET') { respond(200, { ok: true }); return; }
      // A browser proves its origin with the Origin header. A native client
      // sends none; it may name a configured `flow://` client origin instead,
      // which is not an authentication claim either way — the verifier is.
      const claimsClient = () => origin === body.clientOrigin || (!origin && connector.isNativeOrigin(body.clientOrigin));
      if (path === '/v1/oauth/start' && req.method === 'POST') {
        if (!claimsClient()) throw new Fault('origin_mismatch', 403);
        respond(200, connector.start(body)); return;
      }
      if (path === '/v1/oauth/poll' && req.method === 'POST') {
        if (!claimsClient()) throw new Fault('origin_mismatch', 403);
        respond(200, connector.poll(body)); return;
      }
      if (path === '/v1/oauth/exchange' && req.method === 'POST') {
        if (!claimsClient()) throw new Fault('origin_mismatch', 403);
        respond(200, connector.exchange(body)); return;
      }
      if (path === '/v1/connection' && req.method === 'GET') { respond(200, await connector.info(credential)); return; }
      if (path === '/v1/session' && req.method === 'DELETE') { connector.disconnect(credential); respond(200, { ok: true }); return; }
      if (path === '/v1/grant' && req.method === 'DELETE') { connector.removeGrant(credential); respond(200, { ok: true }); return; }
      if (path === '/v1/messages' && req.method === 'POST') { respond(200, await connector.send(credential, body)); return; }
      if (path === '/v1/events' && req.method === 'GET') { respond(200, { events: connector.events(credential) }); return; }
      // Public-API baseline (#545). Read routes take their parameters from the
      // query string; mutations take JSON bodies. Every route is credential-bound
      // and capability-checked by the connector; a missing scope is 403
      // `missing_scopes`, a parked rate budget is 429 with Retry-After.
      const query = new URL(req.url, connector.publicOrigin).searchParams;
      if (path === '/v1/workspace' && req.method === 'GET') { respond(200, await connector.workspace(credential)); return; }
      if (path === '/v1/conversations' && req.method === 'GET') { respond(200, { conversations: await connector.conversations(credential) }); return; }
      if (path === '/v1/members' && req.method === 'GET') { respond(200, { members: await connector.members(credential) }); return; }
      if (path === '/v1/history' && req.method === 'GET') { respond(200, await connector.history(credential, { channel: query.get('channel'), cursor: query.get('cursor'), limit: query.get('limit') })); return; }
      if (path === '/v1/replies' && req.method === 'GET') { respond(200, await connector.replies(credential, { channel: query.get('channel'), ts: query.get('ts'), cursor: query.get('cursor') })); return; }
      if (path === '/v1/search' && req.method === 'GET') { respond(200, await connector.search(credential, { query: query.get('q'), cursor: query.get('cursor') })); return; }
      if (path === '/v1/stream' && req.method === 'GET') { respond(200, connector.stream(credential, query.get('since'))); return; }
      if (path === '/v1/messages' && req.method === 'PATCH') { respond(200, await connector.update(credential, body)); return; }
      if (path === '/v1/messages' && req.method === 'DELETE') { respond(200, await connector.remove(credential, body)); return; }
      if (path === '/v1/reactions' && req.method === 'POST') { respond(200, await connector.reaction(credential, body)); return; }
      if (path === '/v1/read' && req.method === 'POST') { respond(200, await connector.markRead(credential, body)); return; }
      throw new Fault('not_found', 404);
    } catch (error) {
      // Never serialize Slack responses, URLs, request bodies, or exception text.
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      respond(error instanceof Fault ? error.status : 500, { error: error instanceof Fault ? error.code : 'connector_error' });
    }
  });
}
