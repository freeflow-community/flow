// Slack Web API core method set (phase4.md §1). Every method is scoped to the
// authenticated bot's app.workspaceId, and the bot acts as its own user id —
// the services enforce membership/permissions exactly as they do for humans
// (bots join channels like anyone).
//
// Judgment-call notes:
//  - conversations.history/replies pagination: cursor is the boundary message
//    uuid (before-uuid for history, after-uuid for replies). `oldest`/`latest`
//    are UNSUPPORTED and ignored (documented; cursor pagination only).
//  - files.upload authenticates via the Authorization header for multipart
//    bodies (a `token` multipart field is not read); Slack SDKs send the header.
import type { FastifyRequest } from 'fastify';
import {
  EMOJI_SHORTCODES,
  markdownToMrkdwn,
  mrkdwnToMarkdown,
  type ChannelDTO,
  type FileDTO,
  type MessageDTO,
} from '@flow/shared';
import { config } from '../config.js';
import { newId } from '../lib/ids.js';
import type { BotAuth } from '../services/apps.js';
import * as ws from '../services/workspaces.js';
import * as ch from '../services/channels.js';
import * as msg from '../services/messages.js';
import * as rx from '../services/reactions.js';
import * as fl from '../services/files.js';
import { tsFromUuid, uuidFromTs } from './ts.js';
import { channelMemberIds, workspaceUserRow, workspaceUserRows, type UserRow } from './store.js';

/** A Slack-string error thrown by a method body; the envelope wrapper renders it. */
export class SlackApiError extends Error {
  constructor(public readonly slackError: string) {
    super(slackError);
    this.name = 'SlackApiError';
  }
}

export interface MethodCtx {
  auth: BotAuth;
  args: Record<string, unknown>;
  req: FastifyRequest;
}

export interface MethodDef {
  handler: (ctx: MethodCtx) => Promise<Record<string, unknown>>;
  /** Read-only methods also accept GET with query params. */
  readOnly?: boolean;
}

// ---- arg helpers ------------------------------------------------

function strArg(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  if (typeof v !== 'string' || v.length === 0) throw new SlackApiError('invalid_arguments');
  return v;
}

function optStrArg(args: Record<string, unknown>, name: string): string | undefined {
  const v = args[name];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new SlackApiError('invalid_arguments');
  return v;
}

function limitArg(args: Record<string, unknown>, def: number, max: number): number {
  const raw = args['limit'];
  if (raw === undefined || raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) throw new SlackApiError('invalid_arguments');
  return Math.min(Math.floor(n), max);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts a channel id, "#name", or a bare name (looked up in the bot's workspace). */
async function resolveChannelId(auth: BotAuth, ref: string): Promise<string> {
  if (UUID_RE.test(ref)) return ref.toLowerCase();
  const name = (ref.startsWith('#') ? ref.slice(1) : ref).toLowerCase();
  const list = await ch.listChannels(auth.app.workspaceId, auth.botUser.id);
  const found = list.find((c) => c.name?.toLowerCase() === name);
  if (!found) throw new SlackApiError('channel_not_found');
  return found.id;
}

// ---- Slack object shapes ----------------------------------------

const EMOJI_TO_NAME = new Map<string, string>();
for (const [name, emoji] of Object.entries(EMOJI_SHORTCODES)) {
  if (!EMOJI_TO_NAME.has(emoji)) EMOJI_TO_NAME.set(emoji, name);
}

function epochSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

function slackHandle(displayName: string): string {
  return displayName.trim().toLowerCase().replace(/\s+/g, '-');
}

export function toSlackChannel(c: ChannelDTO, memberCount?: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    id: c.id,
    name: c.name ?? '', // DMs have no name — "" plus is_im/is_mpim
    is_channel: c.kind === 'standard',
    is_group: c.kind === 'standard' && c.isPrivate,
    is_im: c.kind === 'dm',
    is_mpim: c.kind === 'group_dm',
    is_private: c.isPrivate,
    is_archived: c.archivedAt !== null,
    is_member: c.isMember,
    created: epochSeconds(c.createdAt),
    topic: { value: c.topic ?? '', creator: '', last_set: 0 },
  };
  const n = memberCount ?? c.memberIds?.length;
  if (n !== undefined) obj['num_members'] = n;
  return obj;
}

function toSlackFile(f: FileDTO): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name,
    mimetype: f.mimeType,
    size: f.sizeBytes,
    url_private: `/v1/files/${f.id}`,
    user: f.userId,
    created: epochSeconds(f.createdAt),
  };
}

export function toSlackMessage(m: MessageDTO): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    type: 'message',
    user: m.userId,
    text: markdownToMrkdwn(m.body),
    ts: tsFromUuid(m.id),
  };
  if (m.threadRootId) {
    obj['thread_ts'] = tsFromUuid(m.threadRootId);
  } else if (m.replyCount > 0) {
    obj['thread_ts'] = tsFromUuid(m.id); // thread root, Slack-style
    obj['reply_count'] = m.replyCount;
  }
  if (m.editedAt) obj['edited'] = { user: m.userId, ts: '' };
  if (m.reactions.length > 0) {
    obj['reactions'] = m.reactions.map((r) => ({
      name: EMOJI_TO_NAME.get(r.emoji) ?? r.emoji,
      users: r.userIds,
      count: r.count,
    }));
  }
  if (m.files.length > 0) obj['files'] = m.files.map(toSlackFile);
  return obj;
}

function toSlackUser(u: UserRow, teamId: string): Record<string, unknown> {
  return {
    id: u.id,
    team_id: teamId,
    name: slackHandle(u.displayName),
    real_name: u.displayName,
    deleted: false,
    is_bot: u.isBot,
    tz: u.timezone,
    profile: {
      real_name: u.displayName,
      display_name: u.displayName,
      email: u.email,
      status_emoji: u.statusEmoji,
      status_text: u.statusText,
    },
  };
}

type SlackChannelType = 'public_channel' | 'private_channel' | 'im' | 'mpim';
const CHANNEL_TYPES: readonly SlackChannelType[] = ['public_channel', 'private_channel', 'im', 'mpim'];

function channelType(c: ChannelDTO): SlackChannelType {
  if (c.kind === 'dm') return 'im';
  if (c.kind === 'group_dm') return 'mpim';
  return c.isPrivate ? 'private_channel' : 'public_channel';
}

function parseTypes(raw: string | undefined): Set<SlackChannelType> {
  if (!raw) return new Set<SlackChannelType>(['public_channel']);
  const out = new Set<SlackChannelType>();
  for (const t of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!(CHANNEL_TYPES as readonly string[]).includes(t)) throw new SlackApiError('invalid_types');
    out.add(t as SlackChannelType);
  }
  if (out.size === 0) out.add('public_channel');
  return out;
}

/** ts arg -> message uuid, or a Slack error. */
async function requireMessageId(channelId: string, ts: string, missing: string): Promise<string> {
  const id = await uuidFromTs(channelId, ts);
  if (!id) throw new SlackApiError(missing);
  return id;
}

// ---- methods ----------------------------------------------------

async function authTest({ auth }: MethodCtx): Promise<Record<string, unknown>> {
  const workspace = await ws.getWorkspace(auth.app.workspaceId, auth.botUser.id);
  return {
    url: `http://${config.host}:${config.port}/`,
    team: workspace.name,
    team_id: workspace.id,
    user: slackHandle(auth.botUser.displayName),
    user_id: auth.botUser.id,
    bot_id: auth.app.id,
  };
}

async function chatPostMessage({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const channelId = await resolveChannelId(auth, strArg(args, 'channel'));
  const text = optStrArg(args, 'text') ?? '';
  const threadTs = optStrArg(args, 'thread_ts');
  if (text.trim() === '' && !threadTs) throw new SlackApiError('no_text');
  let threadRootId: string | undefined;
  if (threadTs) threadRootId = await requireMessageId(channelId, threadTs, 'message_not_found');
  const dto = await msg.sendMessage(channelId, auth.botUser.id, newId(), mrkdwnToMarkdown(text), threadRootId);
  return { channel: channelId, ts: tsFromUuid(dto.id), message: toSlackMessage(dto) };
}

async function chatUpdate({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const channelId = await resolveChannelId(auth, strArg(args, 'channel'));
  const ts = strArg(args, 'ts');
  const text = strArg(args, 'text');
  const id = await requireMessageId(channelId, ts, 'message_not_found');
  const dto = await msg.editMessage(id, auth.botUser.id, mrkdwnToMarkdown(text));
  return { channel: channelId, ts, text: markdownToMrkdwn(dto.body), message: toSlackMessage(dto) };
}

async function chatDelete({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const channelId = await resolveChannelId(auth, strArg(args, 'channel'));
  const ts = strArg(args, 'ts');
  const id = await requireMessageId(channelId, ts, 'message_not_found');
  await msg.deleteMessage(id, auth.botUser.id);
  return { channel: channelId, ts };
}

/** "thumbsup" / ":thumbsup:" / "thumbsup::skin-tone-4" -> unicode emoji. */
function emojiFromName(raw: string): string {
  const name = raw.replace(/^:+|:+$/g, '').replace(/::skin-tone-\d+$/, '').toLowerCase();
  const emoji = EMOJI_SHORTCODES[name];
  if (!emoji) throw new SlackApiError('invalid_name');
  return emoji;
}

async function reactionTarget(auth: BotAuth, args: Record<string, unknown>) {
  const channelId = await resolveChannelId(auth, strArg(args, 'channel'));
  await ch.requireChannelAccess(channelId, auth.botUser.id); // access before any probe
  const emoji = emojiFromName(strArg(args, 'name'));
  const messageId = await requireMessageId(channelId, strArg(args, 'timestamp'), 'message_not_found');
  const aggs = (await rx.reactionsForMessages([messageId])).get(messageId) ?? [];
  const mine = aggs.find((a) => a.emoji === emoji)?.userIds.includes(auth.botUser.id) ?? false;
  return { messageId, emoji, mine };
}

async function reactionsAdd({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const { messageId, emoji, mine } = await reactionTarget(auth, args);
  if (mine) throw new SlackApiError('already_reacted');
  await rx.addReaction(messageId, auth.botUser.id, emoji);
  return {};
}

async function reactionsRemove({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const { messageId, emoji, mine } = await reactionTarget(auth, args);
  if (!mine) throw new SlackApiError('no_reaction');
  await rx.removeReaction(messageId, auth.botUser.id, emoji);
  return {};
}

async function conversationsList({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const types = parseTypes(optStrArg(args, 'types'));
  const chans = await ch.listChannels(auth.app.workspaceId, auth.botUser.id);
  const filtered = chans.filter((c) => types.has(channelType(c)));
  return { channels: filtered.map((c) => toSlackChannel(c)), response_metadata: { next_cursor: '' } };
}

async function usersConversations({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const types = parseTypes(optStrArg(args, 'types'));
  const chans = await ch.listChannels(auth.app.workspaceId, auth.botUser.id);
  const filtered = chans.filter((c) => c.isMember && types.has(channelType(c)));
  return { channels: filtered.map((c) => toSlackChannel(c)), response_metadata: { next_cursor: '' } };
}

async function conversationsInfo({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const channelId = await resolveChannelId(auth, strArg(args, 'channel'));
  const { chan, isMember } = await ch.requireChannelAccess(channelId, auth.botUser.id);
  const members = await channelMemberIds(channelId);
  return { channel: toSlackChannel(ch.toChannelDTO(chan, { isMember }), members.length) };
}

async function conversationsHistory({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  // NOTE: `oldest`/`latest` are unsupported; use cursor pagination (cursor = before-uuid).
  const channelId = await resolveChannelId(auth, strArg(args, 'channel'));
  const limit = limitArg(args, 100, 200);
  const cursor = optStrArg(args, 'cursor');
  if (cursor && !UUID_RE.test(cursor)) throw new SlackApiError('invalid_cursor');
  const page = await msg.listMessages(channelId, auth.botUser.id, cursor, limit);
  const last = page.messages[page.messages.length - 1];
  return {
    messages: page.messages.map(toSlackMessage),
    has_more: page.hasMore,
    response_metadata: { next_cursor: page.hasMore && last ? last.id : '' },
  };
}

async function conversationsReplies({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const channelId = await resolveChannelId(auth, strArg(args, 'channel'));
  const rootId = await requireMessageId(channelId, strArg(args, 'ts'), 'thread_not_found');
  const limit = limitArg(args, 100, 200);
  const cursor = optStrArg(args, 'cursor'); // after-uuid
  if (cursor && !UUID_RE.test(cursor)) throw new SlackApiError('invalid_cursor');
  const t = await msg.listThread(rootId, auth.botUser.id, cursor, limit);
  const all = cursor ? t.messages : [t.root, ...t.messages];
  const last = t.messages[t.messages.length - 1];
  return {
    messages: all.map(toSlackMessage),
    has_more: t.hasMore,
    response_metadata: { next_cursor: t.hasMore && last ? last.id : '' },
  };
}

async function conversationsMembers({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const channelId = await resolveChannelId(auth, strArg(args, 'channel'));
  await ch.requireChannelAccess(channelId, auth.botUser.id);
  return { members: await channelMemberIds(channelId), response_metadata: { next_cursor: '' } };
}

async function conversationsJoin({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const channelId = await resolveChannelId(auth, strArg(args, 'channel'));
  const dto = await ch.joinChannel(channelId, auth.botUser.id);
  return { channel: toSlackChannel(dto) };
}

async function conversationsOpen({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const userIds = strArg(args, 'users').split(',').map((s) => s.trim()).filter(Boolean);
  if (userIds.length === 0) throw new SlackApiError('invalid_arguments');
  const dto = await ch.createDm(auth.app.workspaceId, auth.botUser.id, userIds);
  return { channel: { id: dto.id } };
}

async function usersList({ auth }: MethodCtx): Promise<Record<string, unknown>> {
  const rows = await workspaceUserRows(auth.app.workspaceId);
  return {
    members: rows.map((u) => toSlackUser(u, auth.app.workspaceId)),
    response_metadata: { next_cursor: '' },
  };
}

async function usersInfo({ auth, args }: MethodCtx): Promise<Record<string, unknown>> {
  const row = await workspaceUserRow(auth.app.workspaceId, strArg(args, 'user'));
  if (!row) throw new SlackApiError('user_not_found');
  return { user: toSlackUser(row, auth.app.workspaceId) };
}

interface UploadParts {
  data: Buffer | null;
  fields: Record<string, string>;
  filename: string | null;
  mimeType: string | null;
}

async function readUploadParts(req: FastifyRequest, args: Record<string, unknown>): Promise<UploadParts> {
  const out: UploadParts = { data: null, fields: {}, filename: null, mimeType: null };
  const r = req as FastifyRequest & {
    isMultipart?: () => boolean;
    parts?: () => AsyncIterableIterator<
      | { type: 'file'; fieldname: string; filename?: string; mimetype: string; toBuffer(): Promise<Buffer> }
      | { type: 'field'; fieldname: string; value: unknown }
    >;
  };
  if (r.isMultipart?.() && r.parts) {
    for await (const part of r.parts()) {
      if (part.type === 'file') {
        out.data = await part.toBuffer();
        out.filename = part.filename ?? null;
        out.mimeType = part.mimetype;
      } else if (typeof part.value === 'string') {
        out.fields[part.fieldname] = part.value;
      }
    }
  } else {
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string') out.fields[k] = v;
    }
  }
  return out;
}

async function filesUpload({ auth, args, req }: MethodCtx): Promise<Record<string, unknown>> {
  const up = await readUploadParts(req, args);
  if (!up.data && up.fields['content'] !== undefined) {
    up.data = Buffer.from(up.fields['content'], 'utf8');
    up.mimeType ??= 'text/plain';
  }
  if (!up.data) throw new SlackApiError('no_file_data');
  const filename = up.fields['filename'] ?? up.filename ?? 'file';
  const mimeType = up.mimeType ?? 'application/octet-stream';
  const file = await fl.uploadFile(auth.app.workspaceId, auth.botUser.id, filename, mimeType, up.data);

  const channelsArg = up.fields['channels'];
  if (channelsArg) {
    const comment = up.fields['initial_comment'];
    for (const ref of channelsArg.split(',').map((s) => s.trim()).filter(Boolean)) {
      const channelId = await resolveChannelId(auth, ref);
      await msg.sendMessage(
        channelId,
        auth.botUser.id,
        newId(),
        comment ? mrkdwnToMarkdown(comment) : '',
        undefined,
        [file.id],
      );
    }
  }
  return {
    file: {
      id: file.id,
      name: file.name,
      mimetype: file.mimeType,
      size: file.sizeBytes,
      url_private: `/v1/files/${file.id}`,
      user: auth.botUser.id,
      created: epochSeconds(file.createdAt),
    },
  };
}

export const methods: Record<string, MethodDef> = {
  'auth.test': { handler: authTest, readOnly: true },
  'chat.postMessage': { handler: chatPostMessage },
  'chat.update': { handler: chatUpdate },
  'chat.delete': { handler: chatDelete },
  'reactions.add': { handler: reactionsAdd },
  'reactions.remove': { handler: reactionsRemove },
  'conversations.list': { handler: conversationsList, readOnly: true },
  'conversations.info': { handler: conversationsInfo, readOnly: true },
  'conversations.history': { handler: conversationsHistory, readOnly: true },
  'conversations.replies': { handler: conversationsReplies, readOnly: true },
  'conversations.members': { handler: conversationsMembers, readOnly: true },
  'conversations.join': { handler: conversationsJoin },
  'conversations.open': { handler: conversationsOpen },
  'users.conversations': { handler: usersConversations, readOnly: true },
  'users.list': { handler: usersList, readOnly: true },
  'users.info': { handler: usersInfo, readOnly: true },
  'files.upload': { handler: filesUpload },
};
