import { z } from 'zod';

// ---- auth ------------------------------------------------------
/** Email-first: registration takes only an email; name + password are set on
 * the emailed link's "finish your account" form. The autoVerify escape hatch
 * (dev email driver only — QA scripts, dev macOS) registers in one shot and
 * must carry password + displayName. */
export const RegisterBody = z
  .object({
    email: z.string().email().max(320),
    password: z.string().min(8).max(256).optional(),
    displayName: z.string().min(1).max(80).optional(),
    autoVerify: z.boolean().optional(),
  })
  .refine((b) => !b.autoVerify || (b.password !== undefined && b.displayName !== undefined), {
    message: 'autoVerify requires password and displayName',
  });
export type RegisterBody = z.infer<typeof RegisterBody>;

export const CompleteSignupBody = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(8).max(256),
  displayName: z.string().min(1).max(80),
});
export type CompleteSignupBody = z.infer<typeof CompleteSignupBody>;

export const ForgotPasswordBody = z.object({
  email: z.string().email().max(320),
});
export type ForgotPasswordBody = z.infer<typeof ForgotPasswordBody>;

export const ResetPasswordBody = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(8).max(256),
});
export type ResetPasswordBody = z.infer<typeof ResetPasswordBody>;

export const LoginBody = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});
export type LoginBody = z.infer<typeof LoginBody>;

/** Passwordless sign-in: request a one-time link emailed to an existing account. */
export const SigninLinkBody = z.object({
  email: z.string().email().max(320),
});
export type SigninLinkBody = z.infer<typeof SigninLinkBody>;

/** Sign-in-link redeem: the emailed token, exchanged for a session. */
export const ConsumeSigninLinkBody = z.object({
  token: z.string().min(1).max(512),
});
export type ConsumeSigninLinkBody = z.infer<typeof ConsumeSigninLinkBody>;

export const AppLinkExchangeBody = z.object({
  code: z.string().min(1).max(512),
});
export type AppLinkExchangeBody = z.infer<typeof AppLinkExchangeBody>;

/** POST /v1/auth/google — a Google ID token (a signed JWT from Google Identity
 * Services). Sign-in and registration are the same operation with Google. */
export const GoogleAuthBody = z.object({
  idToken: z.string().min(1).max(4096),
});
export type GoogleAuthBody = z.infer<typeof GoogleAuthBody>;

/**
 * Domains that may never be opened up by the workspace self-register toggle
 * (phase16 §5a/§7): "anyone with a gmail" is the whole internet. This list is
 * mandatory — without it the toggle is an open-registration hole.
 */
export const CONSUMER_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'qq.com',
  '163.com',
];

/** Lowercased domain part of an email address, or null if it has no `@`. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/** A domain that may be used for Google domain self-registration. */
export function isSelfRegisterableDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  return d.length > 0 && d.includes('.') && !CONSUMER_EMAIL_DOMAINS.includes(d);
}

// ---- workspaces ------------------------------------------------
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** An email domain the workspace opens to Google self-registration (phase16 §5a).
 * Clients only ever offer the creator's *own* verified domain — it is not
 * free-text — and the server re-checks that plus the consumer denylist. */
const SelfRegisterDomain = z.string().min(3).max(253).toLowerCase();

export const CreateWorkspaceBody = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().regex(SLUG_RE, 'slug must be lowercase alphanumeric with dashes, 3-40 chars'),
  googleSelfRegisterDomain: SelfRegisterDomain.nullable().optional(),
});
export type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBody>;

export const CreateInviteBody = z.object({
  email: z.string().email().max(320),
});
export type CreateInviteBody = z.infer<typeof CreateInviteBody>;

/** PATCH /v1/workspaces/:id — owner/admin only (phase 3.5: workspace branding). */
export const UpdateWorkspaceBody = z
  .object({
    sidebarColor: z.string().min(1).max(32).optional(),
    // phase 11 §10: workspace-wide unfurl switch, and optional allowlist mode
    // (null clears it back to "allow all domains").
    unfurlEnabled: z.boolean().optional(),
    unfurlDomainAllowlist: z.array(z.string().min(1).max(253)).max(200).nullable().optional(),
    // phase 16 §5a: open the workspace to everyone on an email domain who signs
    // in with Google. null turns it off.
    googleSelfRegisterDomain: SelfRegisterDomain.nullable().optional(),
  })
  .refine(
    (b) =>
      b.sidebarColor !== undefined ||
      b.unfurlEnabled !== undefined ||
      b.unfurlDomainAllowlist !== undefined ||
      b.googleSelfRegisterDomain !== undefined,
    'nothing to update',
  );
export type UpdateWorkspaceBody = z.infer<typeof UpdateWorkspaceBody>;

export const AcceptInviteBody = z.object({
  token: z.string().min(16).max(128),
});
export type AcceptInviteBody = z.infer<typeof AcceptInviteBody>;

/** POST /v1/join-links/redeem — the persistent workspace join link (issue #85).
 * The slug is carried for a readable URL; the token alone identifies the link. */
export const RedeemJoinLinkBody = z.object({
  token: z.string().min(16).max(128),
});
export type RedeemJoinLinkBody = z.infer<typeof RedeemJoinLinkBody>;

/**
 * PATCH /v1/workspaces/:id/members/:userId/role — owner/admin manage users
 * (admin panel). Only 'admin' and 'member' are assignable; 'owner' is fixed.
 */
export const SetMemberRoleBody = z.object({
  role: z.enum(['admin', 'member']),
});
export type SetMemberRoleBody = z.infer<typeof SetMemberRoleBody>;

// ---- channels --------------------------------------------------
export const CHANNEL_NAME_RE = /^[a-z0-9][a-z0-9-_]{0,79}$/;

export const CreateChannelBody = z.object({
  name: z.string().regex(CHANNEL_NAME_RE, 'channel name must be lowercase [a-z0-9-_], max 80 chars'),
  topic: z.string().max(250).optional(),
  isPrivate: z.boolean().optional(),
});
export type CreateChannelBody = z.infer<typeof CreateChannelBody>;

/** PATCH /v1/channels/:id — rename and/or set topic (standard channels only;
 * any channel member, see decision_log 2026-07-19). Empty topic clears it. */
export const UpdateChannelBody = z
  .object({
    name: z.string().regex(CHANNEL_NAME_RE, 'channel name must be lowercase [a-z0-9-_], max 80 chars').optional(),
    topic: z.string().max(250).optional(),
  })
  .refine((b) => b.name !== undefined || b.topic !== undefined, 'nothing to update');
export type UpdateChannelBody = z.infer<typeof UpdateChannelBody>;

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
  /**
   * "I'm looking at this thread" (issue #63): marks the thread's notifications
   * read without touching the channel's own read cursor, which only tracks
   * top-level messages. Absent = a plain channel read.
   */
  threadRootId: z.string().uuid().optional(),
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
/**
 * `workspaceId` scopes the feed to one workspace — Activity is a row inside a
 * workspace's sidebar, so it must only show that workspace's rows. Optional so
 * clients built before the scoping (shipped macOS builds) still get the old
 * cross-workspace feed rather than an error.
 */
export const ListNotificationsQuery = z.object({
  workspaceId: z.string().uuid().optional(),
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuery>;

/**
 * Either a cursor (everything up to it) or a single row (one Activity click).
 * `workspaceId` scopes a cursor sweep, so opening Activity in one workspace
 * can't mark another workspace's older rows read. Ignored alongside `id`,
 * which already names a single row.
 */
export const MarkNotificationsReadBody = z
  .object({
    upToId: z.string().uuid().optional(),
    id: z.string().uuid().optional(),
    workspaceId: z.string().uuid().optional(),
  })
  .refine((b) => b.upToId !== undefined || b.id !== undefined, 'upToId or id required');
export type MarkNotificationsReadBody = z.infer<typeof MarkNotificationsReadBody>;

// ---- profiles --------------------------------------------------
export const NotificationPrefsBody = z.object({
  dm: z.boolean().optional(),
  mention: z.boolean().optional(),
  groupMention: z.boolean().optional(),
  threadReply: z.boolean().optional(),
  reaction: z.boolean().optional(),
  persistentBanners: z.boolean().optional(),
});

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
    // phase 10: per-user notification prefs (shallow-merged server-side) and
    // status-driven alert suppression (set by the status picker for Focusing /
    // In a meeting / At lunch / Do not disturb; cleared on Available/clear).
    notificationPrefs: NotificationPrefsBody.optional(),
    statusSuppressAlerts: z.boolean().optional(),
    // phase 11 §10: don't unfurl links in my own messages
    unfurlOwnLinks: z.boolean().optional(),
  })
  .refine(
    (b) =>
      b.displayName !== undefined ||
      b.timezone !== undefined ||
      b.statusEmoji !== undefined ||
      b.statusText !== undefined ||
      b.notificationPrefs !== undefined ||
      b.statusSuppressAlerts !== undefined ||
      b.unfurlOwnLinks !== undefined,
    'nothing to update',
  )
  .refine(
    (b) => (b.statusEmoji === undefined) === (b.statusText === undefined),
    'statusEmoji and statusText must be set together',
  );
export type PatchMeBody = z.infer<typeof PatchMeBody>;

// ---- Phase 4: Slack app compatibility ---------------------------
/** Outgoing Events API types an app may subscribe to (operator ruling 5). */
export const APP_EVENT_TYPES = [
  'message.channels',
  'message.groups',
  'message.im',
  'app_mention',
  'reaction_added',
  'reaction_removed',
  'member_joined_channel',
  'member_left_channel',
  'channel_created',
  'channel_archive',
] as const;

export const CreateAppBody = z.object({
  name: z.string().min(1).max(80),
});
export type CreateAppBody = z.infer<typeof CreateAppBody>;

// ---- First-class AI agents (AGENT_MEMBERS.md) -------------------
/** Agent usernames: lowercase handle, 3-32 chars, letter/digit first. */
export const AGENT_USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Agent invite codes: `flow-XXXX-XXXX` over a no-confusables uppercase alphabet
 *  (generated in Flow, redeemed once). Short + readable by design. */
export const AGENT_INVITE_CODE_RE = /^flow-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** POST /v1/agents/redeem — the bridge trades a one-time invite code (which
 *  carries the sponsor + workspace) plus its durable credentials for a token.
 *  No sponsor approval: redeeming the code IS the authorization. */
export const RedeemAgentInviteBody = z.object({
  code: z.string().regex(AGENT_INVITE_CODE_RE, 'invalid invite code'),
  username: z.string().toLowerCase().regex(AGENT_USERNAME_RE, 'username: 3-32 lowercase letters, digits, . _ -'),
  key: z.string().min(16).max(128),
  name: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
});
export type RedeemAgentInviteBody = z.infer<typeof RedeemAgentInviteBody>;

export const AgentLoginBody = z.object({
  username: z.string().toLowerCase().regex(AGENT_USERNAME_RE),
  key: z.string().min(16).max(128),
});
export type AgentLoginBody = z.infer<typeof AgentLoginBody>;

export const UpdateAppBody = z
  .object({
    eventUrl: z.string().url().max(500).nullable().optional(),
    eventTypes: z.array(z.enum(APP_EVENT_TYPES)).max(APP_EVENT_TYPES.length).optional(),
  })
  .refine((b) => b.eventUrl !== undefined || b.eventTypes !== undefined, 'nothing to update');
export type UpdateAppBody = z.infer<typeof UpdateAppBody>;

// ---- artifacts (phase 13: per-channel shared) -------------------
/** POST /v1/artifacts — pin a file as an artifact in a channel. Any member of
 * the channel can pin. Name defaults to the file name. `ownsFile` marks an
 * artifact whose file was uploaded for it (agent-generated) so deleting the
 * artifact can reap the file. */
/** Pin a file (`fileId`) OR a link (`url`) — exactly one. A link artifact opens
 * in the co-browsing mini-browser; only http(s) URLs are accepted. */
export const CreateArtifactBody = z
  .object({
    channelId: z.string().uuid(),
    fileId: z.string().uuid().optional(),
    url: z.string().url().max(2048).optional(),
    name: z.string().min(1).max(255).optional(),
    ownsFile: z.boolean().optional(),
  })
  .refine((b) => (b.fileId === undefined) !== (b.url === undefined), {
    message: 'provide exactly one of fileId or url',
  })
  .refine((b) => b.url === undefined || /^https?:\/\//i.test(b.url), {
    message: 'url must be http(s)',
  });
export type CreateArtifactBody = z.infer<typeof CreateArtifactBody>;

/** PATCH /v1/artifacts/:id — rename, re-point a file artifact at a new file (the
 * agent "update" path), or re-point a link artifact at a new url (the co-browse
 * navigation path). At least one field required. */
export const UpdateArtifactBody = z
  .object({
    name: z.string().min(1).max(255).optional(),
    fileId: z.string().uuid().optional(),
    url: z.string().url().max(2048).optional(),
    ownsFile: z.boolean().optional(),
  })
  .refine((b) => b.name !== undefined || b.fileId !== undefined || b.url !== undefined, {
    message: 'provide a name, fileId, and/or url',
  })
  .refine((b) => b.url === undefined || /^https?:\/\//i.test(b.url), {
    message: 'url must be http(s)',
  });
export type UpdateArtifactBody = z.infer<typeof UpdateArtifactBody>;

// ---- files: presigned direct upload (R2) -----------------------
export const PresignUploadBody = z.object({
  filename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});
export type PresignUploadBody = z.infer<typeof PresignUploadBody>;
