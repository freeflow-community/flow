// Drizzle mirror of the SQL schema in migrations/0000_init.sql (phase1.md §2).
import {
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  tokenHash: bytea('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  clientInfo: text('client_info'),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey(),
  slug: citext('slug').notNull().unique(),
  name: text('name').notNull(),
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
  (t) => [uniqueIndex().on(t.workspaceId, t.email)],
);

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: citext('name').notNull(),
    topic: text('topic'),
    isPrivate: boolean('is_private').notNull().default(false),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.name)],
);

export const channelMembers = pgTable(
  'channel_members',
  {
    channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastReadMsgId: uuid('last_read_msg_id'),
    notifyLevel: smallint('notify_level').notNull().default(1),
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
