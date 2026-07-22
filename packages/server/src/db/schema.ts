// Drizzle mirror of the SQL schema in migrations/ (phase1.md §2 + phase2.md §1-§6).
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  timezone: text('timezone').notNull().default('UTC'),
  isBot: boolean('is_bot').notNull().default(false), // phase 4: app bot users
  isAgent: boolean('is_agent').notNull().default(false), // first-class AI agents (AGENTS_DESIGN.md)
  // Agents only (AGENT_MEMBERS.md): the human member responsible for the agent,
  // and the agent's durable credentials (username + argon2 key hash) — nulled
  // on removal so a removed agent can never log back in.
  sponsorUserId: uuid('sponsor_user_id').references((): AnyPgColumn => users.id),
  agentUsername: citext('agent_username').unique(),
  agentKeyHash: text('agent_key_hash'),
  statusEmoji: text('status_emoji').notNull().default(''),
  statusText: text('status_text').notNull().default(''),
  // Phase 10: per-user notification prefs ({dm, mention, groupMention,
  // threadReply, persistentBanners} — absent key = default) and the
  // status-driven "suppress all alerts" flag (DND-family statuses).
  notificationPrefs: jsonb('notification_prefs').$type<Record<string, boolean>>().notNull().default({}),
  statusSuppressAlerts: boolean('status_suppress_alerts').notNull().default(false),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  // Tombstone: set when a human is removed from their last workspace. The row is
  // kept for message authorship; the service vacates `email` so it frees up.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Email-first registration: a signup link in flight, no user row yet. */
export const pendingSignups = pgTable(
  'pending_signups',
  {
    tokenHash: bytea('token_hash').primaryKey(),
    email: citext('email').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('pending_signups_email_idx').on(t.email)],
);

/** Single-use emailed tokens: verify-email, password-reset, and sign-in links. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    tokenHash: bytea('token_hash').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['verify_email', 'password_reset', 'signin'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('email_tokens_user_purpose_idx').on(t.userId, t.purpose)],
);

export const sessions = pgTable('sessions', {
  tokenHash: bytea('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  clientInfo: text('client_info'),
});

/** One-time web-to-app auth handoff codes (flow://signin deep link). */
export const appLinkCodes = pgTable('app_link_codes', {
  codeHash: bytea('code_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey(),
  slug: citext('slug').notNull().unique(),
  name: text('name').notNull(),
  sidebarColor: text('sidebar_color').notNull().default('violet'), // preset id (phase 3.5)
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'member']);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index().on(t.userId)],
);

export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  },
  // one PENDING invite per email; accepted invites are history, not locks
  (t) => [uniqueIndex('invites_pending_unique').on(t.workspaceId, t.email).where(sql`accepted_at IS NULL`)],
);

export const channelKind = pgEnum('channel_kind', ['standard', 'dm', 'group_dm']);

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: citext('name'), // null for dm/group_dm
    kind: channelKind('kind').notNull().default('standard'),
    dmKey: text('dm_key'), // sorted member ids joined with ':'
    topic: text('topic'),
    isPrivate: boolean('is_private').notNull().default(false),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex().on(t.workspaceId, t.name),
    uniqueIndex('chan_dm_key').on(t.workspaceId, t.dmKey).where(sql`dm_key IS NOT NULL`),
  ],
);

export const channelMembers = pgTable(
  'channel_members',
  {
    channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastReadMsgId: uuid('last_read_msg_id'),
    notifyLevel: smallint('notify_level').notNull().default(1), // 0=mute 1=mentions 2=all
  },
  (t) => [primaryKey({ columns: [t.channelId, t.userId] }), index().on(t.userId)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey(),
    channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id),
    threadRootId: uuid('thread_root_id'),
    clientMsgId: uuid('client_msg_id').notNull(),
    body: bytea('body').notNull(),
    bodyNonce: bytea('body_nonce').notNull(),
    encKeyId: text('enc_key_id').notNull(),
    encScheme: smallint('enc_scheme').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    replyCount: integer('reply_count').notNull().default(0),
    lastReplyAt: timestamp('last_reply_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex().on(t.channelId, t.clientMsgId),
    index('msg_channel_top').on(t.channelId, t.id.desc()).where(sql`thread_root_id IS NULL`),
    index('msg_thread').on(t.threadRootId, t.id).where(sql`thread_root_id IS NOT NULL`),
  ],
);

export const reactions = pgTable(
  'reactions',
  {
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(), // unicode emoji, no shortcodes
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] }), index('reactions_message_idx').on(t.messageId)],
);

export const files = pgTable('files', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storageKey: text('storage_key').notNull(),
  encKeyId: text('enc_key_id'), // NULL = plaintext blob (R2 era; legacy rows decrypt via keyring)
  status: text('status').notNull().default('ready'), // 'pending' until a presigned upload is confirmed
  width: integer('width'),
  height: integer('height'),
  thumbKey: text('thumb_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const messageFiles = pgTable(
  'message_files',
  {
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').notNull().references(() => files.id),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.fileId] }), index('message_files_file_idx').on(t.fileId)],
);

/** Phase 9: personal artifact bookmarks — one row per (user, file); the file
 * row itself is never touched by artifact removal (operator ruling). */
export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('artifacts_user_file_unique').on(t.userId, t.fileId),
    index('artifacts_user_ws_idx').on(t.userId, t.workspaceId, t.createdAt.desc()),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
    kind: smallint('kind').notNull(), // 0=mention 1=dm 2=thread_reply 3=channel activity
    // phase 10: for kind 0 — 'mention' | 'here' | 'channel'; NULL otherwise
    subkind: text('subkind'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt, t.id.desc())],
);

// ---- First-class AI agents (AGENTS_DESIGN.md) -------------------

/**
 * On-demand agent registration (AGENT_MEMBERS.md): a pairing request opened by
 * an unauthenticated agent, resolved by its sponsor approving the matching
 * code inside Flow. sponsor_user_id is NULL when sponsorEmail matched no
 * account — the request is accepted anyway (anti-enumeration) and expires.
 */
export const agentPairingRequests = pgTable(
  'agent_pairing_requests',
  {
    id: uuid('id').primaryKey(),
    username: citext('username').notNull(),
    keyHash: text('key_hash').notNull(), // argon2 of the agent's secret key
    name: text('name').notNull(),
    description: text('description'),
    avatarUrl: text('avatar_url'),
    sponsorUserId: uuid('sponsor_user_id').references(() => users.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    pollSecretHash: bytea('poll_secret_hash').notNull().unique(),
    status: text('status', { enum: ['pending', 'approved', 'denied'] }).notNull().default('pending'),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    agentUserId: uuid('agent_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** The agent token is delivered on exactly one poll; afterwards username+key login is the recovery path. */
    tokenDeliveredAt: timestamp('token_delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('agent_pairing_sponsor_idx').on(t.sponsorUserId).where(sql`status = 'pending'`)],
);

/** Agent bearer tokens: non-expiring sibling of `sessions`; revoked_at is the kill switch. */
export const agentTokens = pgTable(
  'agent_tokens',
  {
    id: uuid('id').primaryKey(),
    tokenHash: bytea('token_hash').notNull().unique(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('agent_tokens_user_idx').on(t.userId)],
);

// ---- Phase 4: Slack app compatibility ---------------------------

export const apps = pgTable(
  'apps',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    botUserId: uuid('bot_user_id').notNull().references(() => users.id),
    botTokenHash: bytea('bot_token_hash').notNull().unique(),
    appTokenHash: bytea('app_token_hash').unique(), // xapp- token (Socket Mode); null = HTTP-events only
    // Raw tokens, viewable in Manage Apps (ui_nits; PM ruling pending operator
    // review). NULL on apps created before 0011 — hash can't be reversed.
    botToken: text('bot_token'),
    appToken: text('app_token'),
    signingSecret: text('signing_secret').notNull(),
    eventUrl: text('event_url'),
    eventUrlVerifiedAt: timestamp('event_url_verified_at', { withTimezone: true }),
    eventTypes: text('event_types').array().notNull().default([]),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (t) => [index('apps_workspace_idx').on(t.workspaceId)],
);

/** Events API outbox (decision log 2026-07-18 ruling 3). */
export const pendingAppEvents = pgTable(
  'pending_app_events',
  {
    id: uuid('id').primaryKey(),
    appId: uuid('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
  },
  (t) => [
    index('pending_app_events_due').on(t.nextAttemptAt).where(sql`delivered_at IS NULL AND failed_at IS NULL`),
  ],
);
