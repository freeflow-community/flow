import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z, ZodTypeAny } from 'zod';
import {
  AcceptInviteBody,
  AddChannelMemberBody,
  CreateChannelBody,
  CreateDmBody,
  CreateInviteBody,
  CreateWorkspaceBody,
  EditMessageBody,
  EmojiParam,
  ListMessagesQuery,
  ListNotificationsQuery,
  ListThreadQuery,
  LoginBody,
  MarkNotificationsReadBody,
  MarkReadBody,
  PatchMeBody,
  RegisterBody,
  CreateAppBody,
  SendMessageBody,
  SetNotifyLevelBody,
  UpdateAppBody,
  UpdateWorkspaceBody,
  type UserDTO,
} from '@mychat/shared';
import { ApiError, badRequest, unauthorized } from '../lib/errors.js';
import * as auth from '../services/auth.js';
import * as ws from '../services/workspaces.js';
import * as ch from '../services/channels.js';
import * as msg from '../services/messages.js';
import * as rx from '../services/reactions.js';
import * as fl from '../services/files.js';
import * as nt from '../services/notifications.js';
import * as us from '../services/users.js';
import * as ap from '../services/apps.js';

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

/** Read a single multipart file part into a buffer (20 MB cap enforced by the plugin). */
async function readUpload(req: FastifyRequest): Promise<{ filename: string; mimeType: string; data: Buffer }> {
  const part = await (req as FastifyRequest & { file(): Promise<undefined | { filename?: string; mimetype: string; toBuffer(): Promise<Buffer> }> }).file();
  if (!part) throw badRequest('no_file', 'multipart file field required');
  const data = await part.toBuffer();
  return { filename: part.filename ?? 'file', mimeType: part.mimetype, data };
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

  app.patch('/v1/me', { preHandler: requireAuth }, async (req) => {
    const body = parse(PatchMeBody, req.body);
    return us.patchMe(req.user.id, body);
  });

  app.post('/v1/me/avatar', { preHandler: requireAuth }, async (req) => {
    const { mimeType, data } = await readUpload(req);
    return us.setAvatar(req.user.id, data, mimeType);
  });

  app.get('/v1/me/workspaces', { preHandler: requireAuth }, async (req) => ({
    workspaces: await ws.myWorkspaces(req.user.id),
  }));

  app.get('/v1/me/notifications', { preHandler: requireAuth }, async (req) => {
    const q = parse(ListNotificationsQuery, req.query);
    return nt.listNotifications(req.user.id, q.before, q.limit);
  });

  app.post('/v1/me/notifications/read', { preHandler: requireAuth }, async (req) => {
    const body = parse(MarkNotificationsReadBody, req.body);
    await nt.markNotificationsRead(req.user.id, body.upToId);
    return { ok: true };
  });

  // ---- users / avatars -----------------------------------------
  app.get('/v1/users/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return us.getUser(id, req.user.id);
  });

  app.get('/v1/avatars/:key', { preHandler: requireAuth }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const data = await us.getAvatar(key);
    return reply
      .header('content-type', 'image/webp')
      .header('cache-control', 'private, max-age=31536000, immutable') // key changes per upload
      .header('x-content-type-options', 'nosniff')
      .send(data);
  });

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

  // workspace branding (phase 3.5): owner/admin only
  app.patch('/v1/workspaces/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(UpdateWorkspaceBody, req.body);
    return ws.updateWorkspace(id, req.user.id, body);
  });

  // ---- Slack-compat app management (phase 4, owner/admin, web-only UI) ----
  app.post('/v1/workspaces/:id/apps', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(CreateAppBody, req.body);
    const res = await ap.createApp(id, req.user.id, body.name);
    return reply.status(201).send(res); // { app, botToken } — token shown once
  });

  app.get('/v1/workspaces/:id/apps', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return { apps: await ap.listApps(id, req.user.id) };
  });

  app.patch('/v1/apps/:id', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(UpdateAppBody, req.body);
    return ap.updateApp(id, req.user.id, body);
  });

  app.post('/v1/apps/:id/disable', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return ap.setAppDisabled(id, req.user.id, true);
  });

  app.post('/v1/apps/:id/enable', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return ap.setAppDisabled(id, req.user.id, false);
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

  // DM upsert (phase2.md §1): returns the existing channel for this member set or creates it
  app.post('/v1/workspaces/:id/dms', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(CreateDmBody, req.body);
    const dto = await ch.createDm(id, req.user.id, body.userIds);
    return reply.status(201).send(dto);
  });

  app.post('/v1/channels/:id/join', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return ch.joinChannel(id, req.user.id);
  });

  // ---- channel membership management (phase2.md §5) ------------
  app.post('/v1/channels/:id/members', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parse(AddChannelMemberBody, req.body);
    await ch.addMember(id, req.user.id, body.userId);
    return reply.status(201).send({ ok: true });
  });

  app.delete('/v1/channels/:id/members/:userId', { preHandler: requireAuth }, async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    await ch.removeMember(id, req.user.id, userId);
    return { ok: true };
  });

  app.post('/v1/channels/:id/leave', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    await ch.removeMember(id, req.user.id, req.user.id);
    return { ok: true };
  });

  app.post('/v1/channels/:id/archive', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return ch.archiveChannel(id, req.user.id);
  });

  app.put('/v1/channels/:id/notify', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(SetNotifyLevelBody, req.body);
    await ch.setNotifyLevel(id, req.user.id, body.level);
    return { ok: true };
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
    const dto = await msg.sendMessage(
      id,
      req.user.id,
      body.clientMsgId,
      body.body,
      body.threadRootId,
      body.fileIds,
      body.mentions,
    );
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

  // ---- reactions (phase2.md §2) --------------------------------
  app.put('/v1/messages/:id/reactions/:emoji', { preHandler: requireAuth }, async (req) => {
    const { id, emoji } = req.params as { id: string; emoji: string };
    const parsed = parse(EmojiParam, decodeURIComponent(emoji));
    return { reactions: await rx.addReaction(id, req.user.id, parsed) };
  });

  app.delete('/v1/messages/:id/reactions/:emoji', { preHandler: requireAuth }, async (req) => {
    const { id, emoji } = req.params as { id: string; emoji: string };
    const parsed = parse(EmojiParam, decodeURIComponent(emoji));
    return { reactions: await rx.removeReaction(id, req.user.id, parsed) };
  });

  // ---- files (phase2.md §3) ------------------------------------
  app.post('/v1/workspaces/:id/files', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { filename, mimeType, data } = await readUpload(req);
    const dto = await fl.uploadFile(id, req.user.id, filename, mimeType, data);
    return reply.status(201).send(dto);
  });

  app.get('/v1/files/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const f = await fl.getFileContent(id, req.user.id);
    return reply
      .header('content-type', f.mimeType)
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .header('x-content-type-options', 'nosniff') // never execute uploaded HTML on our origin
      .send(f.data);
  });

  app.get('/v1/files/:id/thumb', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const f = await fl.getThumbContent(id, req.user.id);
    return reply
      .header('content-type', f.mimeType)
      .header('content-disposition', 'inline')
      .header('cache-control', 'private, max-age=31536000, immutable') // thumbs never change for a file id
      .header('x-content-type-options', 'nosniff')
      .send(f.data);
  });
}
