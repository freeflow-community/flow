// Slack public-API payloads -> the normalized DTO shapes every Flow client
// renders (packages/shared/src/dto.ts, backend.ts). One conversion for web,
// macOS and iOS; protocol-specific fields stay here and reach the UI only as
// `provenance` (spec: "protocol-specific payloads stay out of shared UI models").
//
// Identity rules: ids are provider strings, a message id is the exact `ts`,
// `thread_ts` is preserved, no float conversion anywhere.
import { mrkdwnToMarkdown, EMOJI_SHORTCODES } from '@flow/shared';

export const TS_RE = /^\d{9,11}\.\d{6}$/;
export const isTs = value => typeof value === 'string' && TS_RE.test(value);

/** Display-only ISO time from a ts: integer math on the two halves. */
export function tsToIso(ts) {
  if (!isTs(ts)) return null;
  const [seconds, micros] = ts.split('.');
  return new Date(Number(seconds) * 1000 + Math.floor(Number(micros) / 1000)).toISOString();
}

export function openUrl(teamId, channelId, ts) {
  const base = `https://app.slack.com/client/${teamId}/${channelId}`;
  return isTs(ts) ? `${base}/p${ts.replace('.', '')}` : base;
}

/** ":white_check_mark::skin-tone-2" -> unicode when known, else the shortcode. */
export function emojiFromName(name) {
  const bare = String(name ?? '').split('::')[0];
  return EMOJI_SHORTCODES[bare] ?? `:${bare}:`;
}

const KNOWN_BLOCKS = new Set(['rich_text']);
const KNOWN_RICH = new Set(['rich_text_section', 'rich_text_list', 'rich_text_preformatted', 'rich_text_quote']);
const KNOWN_RICH_ELEMENTS = new Set(['text', 'link', 'user', 'usergroup', 'channel', 'emoji', 'broadcast', 'date']);

/** True when the message carries content the clients cannot render from
 * `text` alone: non-rich-text blocks, legacy attachments, or rich elements
 * we do not know. The body then becomes Slack's own text fallback. */
export function isDegraded(message) {
  if (Array.isArray(message.attachments) && message.attachments.length) return true;
  for (const block of message.blocks ?? []) {
    if (!KNOWN_BLOCKS.has(block.type)) return true;
    for (const section of block.elements ?? []) {
      if (!KNOWN_RICH.has(section.type)) return true;
      for (const element of section.elements ?? []) if (!KNOWN_RICH_ELEMENTS.has(element.type)) return true;
    }
  }
  return false;
}

const SYSTEM_KINDS = { channel_join: 'member_joined', channel_leave: 'member_left', group_join: 'member_joined', group_leave: 'member_left' };

export function normalizeFile(file, { teamId, userId }) {
  return {
    id: String(file.id), workspaceId: teamId, userId: String(file.user ?? userId ?? ''), name: String(file.name ?? file.title ?? 'file'),
    mimeType: String(file.mimetype ?? 'application/octet-stream'), sizeBytes: Number(file.size ?? 0) || 0,
    width: Number.isFinite(file.original_w) ? file.original_w : null, height: Number.isFinite(file.original_h) ? file.original_h : null,
    hasThumb: false, createdAt: Number.isFinite(file.created) ? new Date(file.created * 1000).toISOString() : '',
  };
}

export function normalizeReactions(reactions) {
  return (reactions ?? []).map(r => ({ emoji: emojiFromName(r.name), count: Number(r.count ?? r.users?.length ?? 0) || 0, userIds: (r.users ?? []).map(String) }));
}

/** A Slack message (history/replies/event/chat.* reply) -> BackendMessage. */
export function normalizeMessage(message, { teamId, channelId }) {
  const ts = message.ts;
  if (!isTs(ts)) throw new Error('slack message without a ts');
  const channel = String(channelId ?? message.channel ?? '');
  const threadTs = isTs(message.thread_ts) && message.thread_ts !== ts ? message.thread_ts : null;
  const degraded = isDegraded(message);
  const systemKind = SYSTEM_KINDS[message.subtype] ?? null;
  return {
    id: ts, channelId: channel, userId: String(message.user ?? message.bot_id ?? ''), threadRootId: threadTs,
    clientMsgId: typeof message.client_msg_id === 'string' ? message.client_msg_id : '',
    body: mrkdwnToMarkdown(String(message.text ?? '')), createdAt: tsToIso(ts),
    editedAt: message.edited?.ts ? tsToIso(message.edited.ts) : null, deletedAt: null, pinnedAt: null, pinnedBy: null,
    replyCount: Number(message.reply_count ?? 0) || 0, lastReplyAt: isTs(message.latest_reply) ? tsToIso(message.latest_reply) : null,
    systemKind, scheduled: false, replyParticipantUserIds: (message.reply_users ?? []).slice(0, 4).map(String),
    reactions: normalizeReactions(message.reactions), files: (message.files ?? []).map(f => normalizeFile(f, { teamId, userId: message.user })), unfurls: [],
    provenance: { provider: 'slack', openUrl: openUrl(teamId, channel, ts), degraded, subtype: message.subtype ?? null },
  };
}

/** users.conversations / conversations.list item -> BackendChannel. */
export function normalizeChannel(channel, { teamId, selfUserId, handles = null }) {
  const kind = channel.is_im ? 'dm' : channel.is_mpim ? 'group_dm' : 'standard';
  let memberIds = channel.is_im ? [String(channel.user), selfUserId].filter(Boolean) : undefined;
  if (channel.is_mpim && handles) {
    const names = String(channel.name ?? '').replace(/^mpdm-/, '').replace(/-\d+$/, '').split('--');
    const ids = names.map(n => handles.get(n)).filter(Boolean);
    if (ids.length) memberIds = [...new Set([...ids, selfUserId].filter(Boolean))];
  }
  return {
    id: String(channel.id), workspaceId: teamId, name: kind === 'standard' ? String(channel.name ?? channel.id) : null, kind,
    topic: channel.topic?.value || null, isPrivate: Boolean(channel.is_private || channel.is_im || channel.is_mpim),
    createdBy: String(channel.creator ?? ''), createdAt: Number.isFinite(channel.created) ? new Date(channel.created * 1000).toISOString() : '',
    archivedAt: channel.is_archived ? '' : null, isMember: channel.is_member !== false, lastReadMsgId: isTs(channel.last_read) ? channel.last_read : null,
    unreadCount: 0, unreadNotifications: 0, unreadThreadRootIds: [], notifyLevel: 1, parentId: null,
    ...(memberIds ? { memberIds } : {}), provenance: { provider: 'slack', openUrl: openUrl(teamId, channel.id) },
  };
}

/** users.list member -> WorkspaceMemberDTO. */
export function normalizeMember(user) {
  const profile = user.profile ?? {};
  return {
    userId: String(user.id), displayName: String(profile.display_name || profile.real_name || user.real_name || user.name || user.id),
    email: typeof profile.email === 'string' ? profile.email : '', avatarUrl: typeof profile.image_72 === 'string' ? profile.image_72 : null,
    statusEmoji: emojiStatus(profile.status_emoji), statusText: String(profile.status_text ?? ''), title: String(profile.title ?? ''),
    isAgent: false, isBot: Boolean(user.is_bot || user.id === 'USLACKBOT'), sponsorId: null, privacyMode: false,
    role: user.is_owner ? 'owner' : user.is_admin ? 'admin' : 'member', joinedAt: '', deleted: Boolean(user.deleted),
  };
}

function emojiStatus(value) {
  if (typeof value !== 'string' || !value) return '';
  return emojiFromName(value.replace(/^:|:$/g, ''));
}

/** The team a grant belongs to, as the one workspace a Slack connection lists. */
export function normalizeWorkspace(grant) {
  return { id: grant.identity.teamId, slug: grant.identity.teamId, name: String(grant.teamName ?? grant.identity.teamId), createdBy: '', createdAt: '', sidebarColor: 'slate', avatarUrl: null, googleSelfRegisterDomain: null, role: 'member' };
}

/** An Events API `event` -> BackendEvent, or null when it is not a chat event
 * the clients render. Membership/authorization is the caller's job. */
export function normalizeEvent(event, { teamId }) {
  if (!event || typeof event !== 'object') return null;
  if (event.type === 'message') {
    const channelId = String(event.channel ?? '');
    if (event.subtype === 'message_deleted' && isTs(event.deleted_ts)) {
      const previous = event.previous_message ?? {};
      return { type: 'message.deleted', channelId, messageId: event.deleted_ts, threadRootId: isTs(previous.thread_ts) && previous.thread_ts !== event.deleted_ts ? previous.thread_ts : null };
    }
    if (event.subtype === 'message_changed' && event.message?.ts) return { type: 'message.updated', message: normalizeMessage(event.message, { teamId, channelId }) };
    if (event.subtype === 'message_replied') return null; // the reply itself arrives as its own event
    if (!isTs(event.ts)) return null;
    const message = normalizeMessage(event, { teamId, channelId });
    return { type: message.threadRootId ? 'thread.reply' : 'message.created', message };
  }
  if (event.type === 'reaction_added' || event.type === 'reaction_removed') {
    if (event.item?.type !== 'message' || !isTs(event.item.ts)) return null;
    return { type: event.type === 'reaction_added' ? 'reaction.added' : 'reaction.removed', channelId: String(event.item.channel), messageId: event.item.ts, emoji: emojiFromName(event.reaction), userId: String(event.user ?? '') };
  }
  return null;
}
