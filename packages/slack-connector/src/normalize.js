// Slack public-API payloads -> the normalized DTO shapes every Flow client
// renders (packages/shared/src/dto.ts, backend.ts). One conversion for web,
// macOS and iOS; protocol-specific fields stay here and reach the UI only as
// `provenance` (spec: "protocol-specific payloads stay out of shared UI models").
//
// Identity rules: ids are provider strings, a message id is the exact `ts`,
// `thread_ts` is preserved, no float conversion anywhere.
import { readFileSync } from 'node:fs';
import { mrkdwnToMarkdown, EMOJI_SHORTCODES } from '@flow/shared';

/** Every standard Slack emoji name -> unicode (scripts/build-slack-emoji.mjs).
 * The shared table wins where both have a name, so Flow's picker and Slack's
 * names round-trip to the same character. */
export const SLACK_EMOJI = JSON.parse(readFileSync(new URL('./slack-emoji.json', import.meta.url), 'utf8'));
// Skin tones are modifiers, never emoji on their own (`:wave::skin-tone-3:`).
export const lookupEmoji = name => (/^skin-tone-/.test(name) ? null : EMOJI_SHORTCODES[name] ?? SLACK_EMOJI[name] ?? null);

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

const SKIN_TONES = { 2: '\u{1F3FB}', 3: '\u{1F3FC}', 4: '\u{1F3FD}', 5: '\u{1F3FE}', 6: '\u{1F3FF}' };
// Slack tags any emoji with the sender's tone; only a modifier base takes it.
const withTone = (emoji, tone) => (/^\p{Emoji_Modifier_Base}/u.test(emoji) ? emoji.replace(/\uFE0F$/, '') + SKIN_TONES[tone] : emoji);

/** "white_check_mark", "wave::skin-tone-3" -> unicode when known, else the
 * shortcode (a custom emoji, which clients draw from the emoji list). */
export function emojiFromName(name) {
  const [bare, tone] = String(name ?? '').split('::');
  const emoji = lookupEmoji(bare);
  if (!emoji) return `:${bare}:`;
  const level = /^skin-tone-([2-6])$/.exec(tone ?? '')?.[1];
  return level ? withTone(emoji, level) : emoji;
}
const CODE_RE = /(```[\s\S]*?```|`[^`\n]+`)/;

/** Slack writes emoji in message text as `:name:` (`:wave::skin-tone-3:` for
 * a tone). Known names become unicode outside code; unknown (custom) names
 * stay as text. A tone follows its emoji as a modifier, or is dropped. */
export function expandBodyEmoji(text) {
  if (!text.includes(':')) return text;
  return text.split(CODE_RE).map((part, i) => i % 2 === 1 ? part : part
    .replace(/:([a-z0-9_+-]+):/g, (raw, name) => lookupEmoji(name) ?? raw)
    .replace(/(\p{Extended_Pictographic}\uFE0F?):skin-tone-([2-6]):/gu, (_, emoji, tone) => withTone(emoji, tone))
    .replace(/:skin-tone-[2-6]:/g, '')).join('');
}

// ---- Block Kit and legacy attachments -> markdown ------------------------------
// Slack shows a message's layout blocks instead of its `text` (which is only a
// fallback), and shows legacy attachments (the colored-bar cards integrations
// post) under the text. Both become markdown here, so every client renders
// them with the body; an attachment is a quote, standing in for the color bar.
// Interactive parts (buttons, menus, inputs) cannot work in Flow: they are
// left out and mark the message degraded, which offers Open in Slack.

const RICH_SECTIONS = new Set(['rich_text_section', 'rich_text_list', 'rich_text_preformatted', 'rich_text_quote']);
const RICH_ELEMENTS = new Set(['text', 'link', 'user', 'usergroup', 'channel', 'emoji', 'broadcast', 'date']);
const LAYOUT_BLOCKS = new Set(['rich_text', 'header', 'section', 'context', 'divider', 'image']);
const PASSIVE_ACCESSORIES = new Set(['image']);

/** A markdown link; a label holding brackets ("[FIRING] …") cannot be a link
 * label, so the text stays and a ↗ carries the link. */
function mdLink(label, url) {
  return /[[\]]/.test(label) ? `${label} [↗](${url})` : `[${label}](${url})`;
}

/** A Block Kit text object: mrkdwn converted, plain_text as written. */
function textObject(value) {
  if (!value || typeof value.text !== 'string') return '';
  return value.type === 'mrkdwn' ? mrkdwnToMarkdown(value.text) : value.text;
}

function richElement(element) {
  switch (element.type) {
    case 'text': {
      let out = String(element.text ?? '');
      if (!out.trim()) return out;
      const style = element.style ?? {};
      if (style.code) return `\`${out}\``;
      if (style.bold) out = `**${out}**`;
      if (style.italic) out = `_${out}_`;
      if (style.strike) out = `~~${out}~~`;
      return out;
    }
    case 'link': return element.text ? mdLink(String(element.text), element.url) : String(element.url ?? '');
    case 'user': return `<@${element.user_id}>`;
    case 'broadcast': return `<!${element.range}>`;
    case 'emoji': return `:${element.name}:`;
    case 'channel': return '#channel';
    case 'usergroup': return '@group';
    case 'date': return String(element.fallback ?? '');
    default: return '';
  }
}

function richText(block) {
  const lines = [];
  const inline = section => (section.elements ?? []).map(richElement).join('');
  for (const section of block.elements ?? []) {
    if (section.type === 'rich_text_section') lines.push(inline(section));
    else if (section.type === 'rich_text_quote') lines.push(...inline(section).split('\n').map(line => `> ${line}`));
    else if (section.type === 'rich_text_preformatted') lines.push('```', inline(section), '```');
    else if (section.type === 'rich_text_list') {
      (section.elements ?? []).forEach((item, i) => lines.push(`${section.style === 'ordered' ? `${i + 1}.` : '-'} ${inline(item)}`));
    }
  }
  return lines.join('\n');
}

/** Layout blocks -> markdown lines; `inQuote` drops dividers, which a quote cannot hold. */
function blocksToMarkdown(blocks, { inQuote = false } = {}) {
  const parts = [];
  for (const block of blocks ?? []) {
    switch (block.type) {
      case 'header': parts.push(`**${textObject(block.text)}**`); break;
      case 'section': {
        const lines = [];
        if (block.text) lines.push(textObject(block.text));
        for (const field of block.fields ?? []) lines.push(textObject(field));
        parts.push(lines.filter(Boolean).join('\n'));
        break;
      }
      case 'context': parts.push((block.elements ?? []).map(textObject).filter(Boolean).join('  ·  ')); break;
      case 'divider': if (!inQuote) parts.push('---'); break;
      case 'image': parts.push(mdLink(String(block.alt_text || block.title?.text || 'image'), block.image_url)); break;
      case 'rich_text': parts.push(richText(block)); break;
      default: break;
    }
  }
  return parts.filter(Boolean).join('\n\n');
}

/** One legacy attachment -> markdown: pretext above, the card as a quote. */
function attachmentToMarkdown(attachment) {
  const card = [];
  if (attachment.author_name) card.push(String(attachment.author_name));
  if (attachment.title) card.push(`**${attachment.title_link ? mdLink(String(attachment.title), attachment.title_link) : attachment.title}**`);
  if (attachment.text) card.push(mrkdwnToMarkdown(String(attachment.text)));
  for (const field of attachment.fields ?? []) {
    if (field.title || field.value) card.push(`${field.title ? `**${field.title}:** ` : ''}${mrkdwnToMarkdown(String(field.value ?? ''))}`);
  }
  if (attachment.blocks?.length) card.push(blocksToMarkdown(attachment.blocks, { inQuote: true }));
  if (attachment.image_url) card.push(`[image](${attachment.image_url})`);
  if (attachment.footer) card.push(mrkdwnToMarkdown(String(attachment.footer)));
  const body = card.filter(Boolean).join('\n') || (attachment.fallback ? mrkdwnToMarkdown(String(attachment.fallback)) : '');
  const quoted = body ? body.split('\n').map(line => (line.trim() ? `> ${line}` : '>')).join('\n') : '';
  return [attachment.pretext ? mrkdwnToMarkdown(String(attachment.pretext)) : '', quoted].filter(Boolean).join('\n');
}

/** What Slack shows for a message, as markdown: layout blocks in place of the
 * fallback text when there are any, then each attachment. */
export function messageMarkdown(message) {
  const blocks = message.blocks ?? [];
  const layout = blocks.some(block => block.type !== 'rich_text');
  const main = layout ? blocksToMarkdown(blocks) : mrkdwnToMarkdown(String(message.text ?? ''));
  return [main, ...(message.attachments ?? []).map(attachmentToMarkdown)].filter(Boolean).join('\n\n');
}

function blocksDegraded(blocks) {
  for (const block of blocks ?? []) {
    if (!LAYOUT_BLOCKS.has(block.type)) return true;
    if (block.accessory && !PASSIVE_ACCESSORIES.has(block.accessory.type)) return true;
    for (const section of block.type === 'rich_text' ? block.elements ?? [] : []) {
      if (!RICH_SECTIONS.has(section.type)) return true;
      const items = section.type === 'rich_text_list' ? (section.elements ?? []).flatMap(item => item.elements ?? []) : section.elements ?? [];
      for (const element of items) if (!RICH_ELEMENTS.has(element.type)) return true;
    }
  }
  return false;
}

/** True when the message has parts Flow leaves out: interactive blocks or
 * elements (buttons, menus, inputs), unknown block types, or attachment
 * actions. The rest renders through messageMarkdown. */
export function isDegraded(message) {
  if (blocksDegraded(message.blocks)) return true;
  return (message.attachments ?? []).some(a => (a.actions?.length ?? 0) > 0 || blocksDegraded(a.blocks));
}

const SYSTEM_KINDS = { channel_join: 'member_joined', channel_leave: 'member_left', group_join: 'member_joined', group_leave: 'member_left' };

/** Slack's thumbnail for an image file, largest first; null for other files. */
export function slackThumbUrl(file) {
  if (!String(file.mimetype ?? '').startsWith('image/')) return null;
  return file.thumb_720 ?? file.thumb_480 ?? file.thumb_360 ?? null;
}

/** `readFiles`: the grant can fetch file bytes, so an image with a Slack
 * thumbnail previews through the connector's /v1/files routes. */
export function normalizeFile(file, { teamId, userId, readFiles = false }) {
  return {
    id: String(file.id), workspaceId: teamId, userId: String(file.user ?? userId ?? ''), name: String(file.name ?? file.title ?? 'file'),
    mimeType: String(file.mimetype ?? 'application/octet-stream'), sizeBytes: Number(file.size ?? 0) || 0,
    width: Number.isFinite(file.original_w) ? file.original_w : null, height: Number.isFinite(file.original_h) ? file.original_h : null,
    hasThumb: Boolean(readFiles && slackThumbUrl(file)), createdAt: Number.isFinite(file.created) ? new Date(file.created * 1000).toISOString() : '',
  };
}

export function normalizeReactions(reactions) {
  return (reactions ?? []).map(r => ({ emoji: emojiFromName(r.name), count: Number(r.count ?? r.users?.length ?? 0) || 0, userIds: (r.users ?? []).map(String) }));
}

/** A Slack message (history/replies/event/chat.* reply) -> BackendMessage. */
export function normalizeMessage(message, { teamId, channelId, readFiles = false }) {
  const ts = message.ts;
  if (!isTs(ts)) throw new Error('slack message without a ts');
  const channel = String(channelId ?? message.channel ?? '');
  const threadTs = isTs(message.thread_ts) && message.thread_ts !== ts ? message.thread_ts : null;
  const degraded = isDegraded(message);
  const systemKind = SYSTEM_KINDS[message.subtype] ?? null;
  return {
    id: ts, channelId: channel, userId: String(message.user ?? message.bot_id ?? ''), threadRootId: threadTs,
    clientMsgId: typeof message.client_msg_id === 'string' ? message.client_msg_id : '',
    body: expandBodyEmoji(messageMarkdown(message)), createdAt: tsToIso(ts),
    editedAt: message.edited?.ts ? tsToIso(message.edited.ts) : null, deletedAt: null, pinnedAt: null, pinnedBy: null,
    replyCount: Number(message.reply_count ?? 0) || 0, lastReplyAt: isTs(message.latest_reply) ? tsToIso(message.latest_reply) : null,
    systemKind, scheduled: false, replyParticipantUserIds: (message.reply_users ?? []).slice(0, 4).map(String),
    reactions: normalizeReactions(message.reactions), files: (message.files ?? []).map(f => normalizeFile(f, { teamId, userId: message.user, readFiles })), unfurls: [],
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

/** The app or bot that posted a message with no user (an integration, a
 * webhook), as a member row keyed by its `B…` id — so clients name it and
 * draw its icon the way they do for people. Null for a person's message. */
export function botMember(message) {
  if (message.user || typeof message.bot_id !== 'string' || !message.bot_id) return null;
  const profile = message.bot_profile ?? {};
  const icons = { ...(message.icons ?? {}), ...(profile.icons ?? {}) };
  const avatar = icons.image_72 ?? icons.image_48 ?? icons.image_36 ?? null;
  return {
    userId: message.bot_id, displayName: String(profile.name || message.username || 'App'), email: '',
    avatarUrl: typeof avatar === 'string' && avatar.startsWith('https://') ? avatar : null, statusEmoji: '', statusText: '', title: '',
    isAgent: false, isBot: true, sponsorId: null, privacyMode: false, role: 'member', joinedAt: '',
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
export function normalizeWorkspace(grant, { hasIcon = false } = {}) {
  // The icon is served by the connector (/v1/files/team-icon:<team>), on the
  // same path shape as file bytes, so clients load it like any avatar.
  const avatarUrl = hasIcon ? `/v1/files/team-icon:${grant.identity.teamId}` : null;
  return { id: grant.identity.teamId, slug: grant.identity.teamId, name: String(grant.teamName ?? grant.identity.teamId), createdBy: '', createdAt: '', sidebarColor: 'slate', avatarUrl, googleSelfRegisterDomain: null, role: 'member' };
}

/** An Events API `event` -> BackendEvent, or null when it is not a chat event
 * the clients render. Membership/authorization is the caller's job. */
export function normalizeEvent(event, { teamId, readFiles = false }) {
  if (!event || typeof event !== 'object') return null;
  if (event.type === 'message') {
    const channelId = String(event.channel ?? '');
    if (event.subtype === 'message_deleted' && isTs(event.deleted_ts)) {
      const previous = event.previous_message ?? {};
      return { type: 'message.deleted', channelId, messageId: event.deleted_ts, threadRootId: isTs(previous.thread_ts) && previous.thread_ts !== event.deleted_ts ? previous.thread_ts : null };
    }
    if (event.subtype === 'message_changed' && event.message?.ts) return { type: 'message.updated', message: normalizeMessage(event.message, { teamId, channelId, readFiles }) };
    if (event.subtype === 'message_replied') return null; // the reply itself arrives as its own event
    if (!isTs(event.ts)) return null;
    const message = normalizeMessage(event, { teamId, channelId, readFiles });
    return { type: message.threadRootId ? 'thread.reply' : 'message.created', message };
  }
  if (event.type === 'user_change' && event.user && typeof event.user.id === 'string') {
    const { deleted, ...member } = normalizeMember(event.user);
    return { type: 'member.updated', member };
  }
  if (event.type === 'reaction_added' || event.type === 'reaction_removed') {
    if (event.item?.type !== 'message' || !isTs(event.item.ts)) return null;
    return { type: event.type === 'reaction_added' ? 'reaction.added' : 'reaction.removed', channelId: String(event.item.channel), messageId: event.item.ts, emoji: emojiFromName(event.reaction), userId: String(event.user ?? '') };
  }
  return null;
}
