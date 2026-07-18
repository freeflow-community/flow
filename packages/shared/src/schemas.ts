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

// ---- messages --------------------------------------------------
export const SendMessageBody = z.object({
  clientMsgId: z.string().uuid(),
  body: z.string().min(1).max(12000),
  threadRootId: z.string().uuid().optional(),
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
