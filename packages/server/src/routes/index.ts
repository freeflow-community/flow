import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z, ZodTypeAny } from 'zod';
import {
  AcceptInviteBody,
  CreateChannelBody,
  CreateInviteBody,
  CreateWorkspaceBody,
  EditMessageBody,
  ListMessagesQuery,
  ListThreadQuery,
  LoginBody,
  MarkReadBody,
  RegisterBody,
  SendMessageBody,
  type UserDTO,
} from '@mychat/shared';
import { ApiError, badRequest, unauthorized } from '../lib/errors.js';
import * as auth from '../services/auth.js';
import * as ws from '../services/workspaces.js';
import * as ch from '../services/channels.js';
import * as msg from '../services/messages.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserDTO;
    bearerToken: string;
  }
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw badRequest('validation', issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid request');
  }
  return r.data;
}

async function requireAuth(req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized('missing bearer token');
  const token = header.slice('Bearer '.length).trim();
  req.bearerToken = token;
  req.user = await auth.authenticate(token);
}

export function registerRoutes(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, _req, reply: FastifyReply) => {
    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    const fastifyErr = err as { statusCode?: number; message?: string };
    if (fastifyErr.statusCode && fastifyErr.statusCode < 500) {
      return reply
        .status(fastifyErr.statusCode)
        .send({ error: { code: 'bad_request', message: fastifyErr.message ?? 'bad request' } });
    }
    app.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: 'internal server error' } });
  });

  app.get('/healthz', async () => ({ ok: true }));

  // ---- auth ----------------------------------------------------
  app.post('/v1/auth/register', async (req, reply) => {
    const body = parse(RegisterBody, req.body);
    const res = await auth.register(body.email, body.password, body.displayName, req.headers['user-agent']);
    return reply.status(201).send(res);
  });

  app.post('/v1/auth/login', async (req) => {
    const body = parse(LoginBody, req.body);
    return auth.login(body.email, body.password, req.headers['user-agent']);
  });

  app.post('/v1/auth/logout', { preHandler: requireAuth }, async (req) => {
    await auth.logout(req.bearerToken);
    return { ok: true };
  });

  // ---- me ------------------------------------------------------
  app.get('/v1/me', { preHandler: requireAuth }, async (req) => req.user);

  app.get('/v1/me/workspaces', { preHandler: requireAuth }, async (req) => ({
    workspaces: await ws.myWorkspaces(req.user.id),
  }));

  // ---- workspaces ----------------------------------------------
  app.post('/v1/workspaces', { preHandler: requireAuth }, async (req, reply) => {
    const body = parse(CreateWorkspaceBody, req.body);
    const dto = await ws.createWorkspace(req.user.id, body.name, body.slug);
    return reply.status(201).send(dto);
  });

  app.get('/v1/workspaces/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return ws.getWorkspace(id, req.user.id);
  });

  app.post('/v1/workspaces/:id/invites', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(CreateInviteBody, req.body);
    const dto = await ws.createInvite(id, req.user.id, body.email);
    return reply.status(201).send(dto);
  });

  app.post('/v1/invites/accept', { preHandler: requireAuth }, async (req) => {
    const body = parse(AcceptInviteBody, req.body);
    return ws.acceptInvite(req.user.id, body.token);
  });

  app.get('/v1/workspaces/:id/members', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return { members: await ws.listMembers(id, req.user.id) };
  });

  // ---- channels ------------------------------------------------
  app.post('/v1/workspaces/:id/channels', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(CreateChannelBody, req.body);
    const dto = await ch.createChannel(id, req.user.id, body.name, body.topic, body.isPrivate);
    return reply.status(201).send(dto);
  });

  app.get('/v1/workspaces/:id/channels', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return { channels: await ch.listChannels(id, req.user.id) };
  });

  app.post('/v1/channels/:id/join', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return ch.joinChannel(id, req.user.id);
  });

  app.post('/v1/channels/:id/read', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(MarkReadBody, req.body);
    await ch.markRead(id, req.user.id, body.lastReadMsgId);
    return { ok: true };
  });

  // ---- messages ------------------------------------------------
  app.get('/v1/channels/:id/messages', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const q = parse(ListMessagesQuery, req.query);
    return msg.listMessages(id, req.user.id, q.before, q.limit);
  });

  app.post('/v1/channels/:id/messages', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(SendMessageBody, req.body);
    const dto = await msg.sendMessage(id, req.user.id, body.clientMsgId, body.body, body.threadRootId);
    return reply.status(201).send(dto);
  });

  app.patch('/v1/messages/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(EditMessageBody, req.body);
    return msg.editMessage(id, req.user.id, body.body);
  });

  app.delete('/v1/messages/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    await msg.deleteMessage(id, req.user.id);
    return { ok: true };
  });

  app.get('/v1/messages/:id/thread', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const q = parse(ListThreadQuery, req.query);
    return msg.listThread(id, req.user.id, q.after, q.limit);
  });
}
