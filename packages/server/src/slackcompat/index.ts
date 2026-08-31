// Slack Web API compatibility surface (phase4.md §1), mounted at /api/<method>.
//
// Slack conventions honored:
//  - POST /api/<method> for everything; read-only methods also accept GET with
//    query params (form-encoded or JSON bodies both work — @fastify/formbody).
//  - Bearer bot token ("xoxb-…") in the Authorization header, or a `token`
//    body/query param. Bad/missing/disabled -> {ok:false, error:"invalid_auth"}.
//  - EVERY response is HTTP 200 with a Slack envelope: {ok:true, ...} or
//    {ok:false, error:"<slack_error_string>"}.
//  - Unknown /api/* method -> {ok:false, error:"unknown_method"}.
//
// ApiError -> Slack error string mapping (see mapApiError):
//   401                      -> invalid_auth
//   404 "…user…"             -> user_not_found
//   404 "…message/thread…"   -> message_not_found
//   404 "…file…"             -> file_not_found
//   404 (channel/workspace)  -> channel_not_found
//   403 chat.update          -> cant_update_message   (author-only edit)
//   403 chat.delete          -> cant_delete_message   (author-only delete)
//   403 posting/uploading    -> not_in_channel
//   403 otherwise (joining…) -> restricted_action
//   400 channel_archived     -> is_archived
//   400 message_deleted      -> message_not_found
//   400 bad_thread_root /
//       not_a_root           -> thread_not_found
//   400 dm_channel           -> method_not_supported_for_channel_type
//   400 bad_user             -> user_not_found
//   400/409 anything else    -> invalid_arguments
//   unhandled exception      -> internal_error (still HTTP 200; logged)
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../lib/errors.js';
import { config } from '../config.js';
import { authenticateAppToken, authenticateBot } from '../services/apps.js';
import { mintSocketTicket } from '../gateway/socketMode.js';
import { methods, SlackApiError } from './methods.js';

function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  const body = req.body;
  if (body && typeof body === 'object') {
    const t = (body as Record<string, unknown>)['token'];
    if (typeof t === 'string' && t.length > 0) return t;
  }
  const query = req.query;
  if (query && typeof query === 'object') {
    const t = (query as Record<string, unknown>)['token'];
    if (typeof t === 'string' && t.length > 0) return t;
  }
  return null;
}

function mapApiError(err: ApiError, method: string): string {
  const msg = err.message.toLowerCase();
  switch (err.statusCode) {
    case 401:
      return 'invalid_auth';
    case 404:
      if (msg.includes('user')) return 'user_not_found';
      if (msg.includes('message') || msg.includes('thread')) return 'message_not_found';
      if (msg.includes('file') || msg.includes('thumbnail')) return 'file_not_found';
      return 'channel_not_found'; // channel + workspace not-found both scope to the channel ref
    case 403:
      if (method === 'chat.update') return 'cant_update_message';
      if (method === 'chat.delete') return 'cant_delete_message';
      if (method === 'chat.postMessage' || method === 'files.upload') return 'not_in_channel';
      return 'restricted_action';
    case 400:
    case 409:
      switch (err.code) {
        case 'channel_archived':
          return 'is_archived';
        case 'message_deleted':
          return 'message_not_found';
        case 'bad_thread_root':
        case 'not_a_root':
          return 'thread_not_found';
        case 'dm_channel':
          return 'method_not_supported_for_channel_type';
        case 'bad_user':
          return 'user_not_found';
        default:
          return 'invalid_arguments';
      }
    default:
      return 'internal_error';
  }
}

export function registerSlackCompat(app: FastifyInstance): void {
  // apps.connections.open authenticates with the app-level "xapp-" token
  // (not the bot token), so it lives outside the methods table. SDKs differ
  // in where they put it: @slack/socket-mode uses the Authorization header,
  // slack_sdk (Python) keeps the BOT token in the header and sends the app
  // token as an `app_token` form/query param — accept all of them.
  app.post('/api/apps.connections.open', async (req, reply) => {
    const fromRecord = (o: unknown, k: string) =>
      o && typeof o === 'object' && typeof (o as Record<string, unknown>)[k] === 'string'
        ? ((o as Record<string, unknown>)[k] as string)
        : null;
    const candidates = [
      fromRecord(req.body, 'app_token'),
      fromRecord(req.query, 'app_token'),
      extractToken(req),
    ];
    const token = candidates.find((t) => t?.startsWith('xapp-')) ?? null;
    const appRow = token ? await authenticateAppToken(token) : null;
    if (!appRow) return reply.code(200).send({ ok: false, error: 'invalid_auth' });
    const ticket = await mintSocketTicket(appRow.id);
    const base = new URL(config.webUrlBase);
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    base.pathname = '/api/socket-mode';
    base.search = `?ticket=${ticket}`;
    return reply.code(200).send({ ok: true, url: base.toString() });
  });

  for (const [name, def] of Object.entries(methods)) {
    const handler = async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractToken(req);
        const auth = token ? await authenticateBot(token) : null;
        if (!auth) return await reply.code(200).send({ ok: false, error: 'invalid_auth' });
        const args: Record<string, unknown> = {
          ...(typeof req.query === 'object' && req.query !== null ? (req.query as Record<string, unknown>) : {}),
          ...(typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {}),
        };
        const result = await def.handler({ auth, args, req });
        return await reply.code(200).send({ ok: true, ...result });
      } catch (err: unknown) {
        if (err instanceof SlackApiError) {
          return reply.code(200).send({ ok: false, error: err.slackError });
        }
        if (err instanceof ApiError) {
          return reply.code(200).send({ ok: false, error: mapApiError(err, name) });
        }
        req.log.error({ err, method: name }, 'slackcompat unhandled error');
        return reply.code(200).send({ ok: false, error: 'internal_error' });
      }
    };
    app.post(`/api/${name}`, handler);
    if (def.readOnly) app.get(`/api/${name}`, handler);
  }

  // Anything else under /api is an unknown Slack method (200 + envelope, Slack-style).
  app.all('/api/*', async (_req, reply) => reply.code(200).send({ ok: false, error: 'unknown_method' }));
}
