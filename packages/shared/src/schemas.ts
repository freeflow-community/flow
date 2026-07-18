import { z } from 'zod';

// ---- auth ------------------------------------------------------
export const RegisterBody = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(256),
  displayName: z.string().min(1).max(80),
});
export type RegisterBody = z.infer<typeof RegisterBody>;

export const LoginBody = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});
export type LoginBody = z.infer<typeof LoginBody>;

// ---- workspaces ------------------------------------------------
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const CreateWorkspaceBody = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().regex(SLUG_RE, 'slug must be lowercase alphanumeric with dashes, 3-40 chars'),
});
export type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBody>;

export const CreateInviteBody = z.object({
  email: z.string().email().max(320),
});
export type CreateInviteBody = z.infer<typeof CreateInviteBody>;

export const AcceptInviteBody = z.object({
  token: z.string().min(16).max(128),
});
export type AcceptInviteBody = z.infer<typeof AcceptInviteBody>;

// ---- channels --------------------------------------------------
export const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9-_]{0,79}$/;

export const CreateChannelBody = z.object({
  name: z.string().regex(CHANNEL_NAME_RE, 'channel name must be lowercase [a-z0-9-_], max 80 chars'),
  topic: z.string().max(250).optional(),
  isPrivate: z.boolean().optional(),
});
export type CreateChannelBody = z.infer<typeof CreateChannelBody>;

/** POST /v1/workspaces/:id/dms — the caller is implicitly included; 1 other user = dm, more = group_dm. */
export const CreateDmBody = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(8), // + caller → max 9 members, Slack's group-DM cap
});
export type CreateDmBody = z.infer<typeof CreateDmBody>;

export const AddChannelMemberBody = z.object({
  userId: z.string().uuid(),
});
export type AddChannelMemberBody = z.infer<typeof AddChannelMemberBody>;

export const SetNotifyLevelBody = z.object({
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]), // 0=mute 1=mentions 2=all
});
export type SetNotifyLevelBody = z.infer<typeof SetNotifyLevelBody>;

// ---- messages --------------------------------------------------
/** Group-mention tokens stored in bodies (Slack-style). */
export const GROUP_MENTION_RE = /<!(channel|here|everyone)>/g;
/** User-mention tokens stored in bodies: <@uuid>. */
export const USER_MENTION_RE = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/g;

export const SendMessageBody = z.object({
  clientMsgId: z.string().uuid(),
  body: z.string().min(1).max(12000),
  threadRootId: z.string().uuid().optional(),
  /** Uploaded-file attachments (phase2 §3): upload first, then reference. */
  fileIds: z.array(z.string().uuid()).max(10).optional(),
  /** Resolved @-mention user ids (phase2 §4): client resolves names, server validates membership. */
  mentions: z.array(z.string().uuid()).max(50).optional(),
});
export type SendMessageBody = z.infer<typeof SendMessageBody>;

export const EditMessageBody = z.object({
  body: z.string().min(1).max(12000),
});
export type EditMessageBody = z.infer<typeof EditMessageBody>;

export const MarkReadBody = z.object({
  lastReadMsgId: z.string().uuid(),
});
export type MarkReadBody = z.infer<typeof MarkReadBody>;

export const ListMessagesQuery = z.object({
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuery>;

export const ListThreadQuery = z.object({
  after: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListThreadQuery = z.infer<typeof ListThreadQuery>;

// ---- reactions -------------------------------------------------
/** A single RGI emoji (incl. ZWJ sequences, skin tones, keycaps). Unicode only — no shortcodes. */
export const EmojiParam = z
  .string()
  .min(1)
  .max(32)
  .refine((s) => /^\p{RGI_Emoji}$/v.test(s), 'must be a single unicode emoji');

// ---- notifications ---------------------------------------------
export const ListNotificationsQuery = z.object({
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuery>;

export const MarkNotificationsReadBody = z.object({
  upToId: z.string().uuid(),
});
export type MarkNotificationsReadBody = z.infer<typeof MarkNotificationsReadBody>;

// ---- profiles --------------------------------------------------
export const PatchMeBody = z
  .object({
    displayName: z.string().min(1).max(80).optional(),
    timezone: z
      .string()
      .max(64)
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'must be a valid IANA timezone name')
      .optional(),
    // status: set both together ({emoji:'🎧', text:'Focusing'}); both '' clears it
    statusEmoji: z
      .string()
      .max(32)
      .refine((s) => s === '' || /^\p{RGI_Emoji}$/v.test(s), 'must be empty or a single unicode emoji')
      .optional(),
    statusText: z.string().max(80).optional(),
  })
  .refine(
    (b) =>
      b.displayName !== undefined ||
      b.timezone !== undefined ||
      b.statusEmoji !== undefined ||
      b.statusText !== undefined,
    'nothing to update',
  )
  .refine(
    (b) => (b.statusEmoji === undefined) === (b.statusText === undefined),
    'statusEmoji and statusText must be set together',
  );
export type PatchMeBody = z.infer<typeof PatchMeBody>;
