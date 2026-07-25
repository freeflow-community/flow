// TanStack Query hooks over the REST API (phase2.md §7: online-only —
// queries are the state; WS events invalidate them).
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { emailDomain, isSelfRegisterableDomain } from '@flow/shared';
import type {
  AgentInviteDTO,
  AppDTO,
  ArtifactDTO,
  ChannelDTO,
  FileDTO,
  MessageDTO,
  MessagePage,
  NotificationPage,
  OAuthIdentityDTO,
  UserDTO,
  WorkspaceDTO,
  WorkspaceMemberDTO,
} from '@flow/shared';
import { api } from './lib/api';
import {
  applyMessageEvent,
  markSendFailed,
  pendingId,
  removePendingMessage,
  type LocalMessage,
} from './lib/messageCache';
import { useAuth } from './state';

export function useWorkspaces() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api<{ workspaces: WorkspaceDTO[] }>('GET', '/v1/me/workspaces'),
    select: (d) => d.workspaces,
  });
}

/**
 * External identities linked to me (phase16 §5a). Only a user who actually
 * signed in with Google may open a workspace to their email domain, so the
 * toggle is offered off the back of this.
 */
export function useIdentities() {
  return useQuery({
    queryKey: ['identities'],
    queryFn: () => api<{ identities: OAuthIdentityDTO[] }>('GET', '/v1/me/identities'),
    select: (d) => d.identities,
    staleTime: Infinity,
  });
}

/** The email domain this user may open a workspace to, or null when they have
 * no Google identity or it's a consumer domain (phase16 §5a denylist). */
export function useSelfRegisterDomain(): string | null {
  const identities = useIdentities();
  const google = (identities.data ?? []).find((i) => i.provider === 'google');
  const domain = google ? emailDomain(google.email) : null;
  return domain && isSelfRegisterableDomain(domain) ? domain : null;
}

export function useChannels(workspaceId: string | null) {
  return useQuery({
    queryKey: ['channels', workspaceId],
    queryFn: () => api<{ channels: ChannelDTO[] }>('GET', `/v1/workspaces/${workspaceId}/channels`),
    select: (d) => d.channels,
    enabled: workspaceId !== null,
  });
}

export function useMembers(workspaceId: string | null) {
  return useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => api<{ members: WorkspaceMemberDTO[] }>('GET', `/v1/workspaces/${workspaceId}/members`),
    select: (d) => d.members,
    enabled: workspaceId !== null,
  });
}

/** userId -> displayName map for the active workspace. */
export function useNameMap(workspaceId: string | null): Record<string, string> {
  const members = useMembers(workspaceId);
  const map: Record<string, string> = {};
  for (const m of members.data ?? []) map[m.userId] = m.displayName;
  return map;
}

/**
 * userId -> displayName with the 🤖 badge appended for agents — display
 * strings only (testids and mention inserts keep the plain useNameMap names).
 */
export function useDisplayNameMap(workspaceId: string | null): Record<string, string> {
  const members = useMembers(workspaceId);
  const map: Record<string, string> = {};
  for (const m of members.data ?? []) map[m.userId] = m.isAgent ? `${m.displayName} 🤖` : m.displayName;
  return map;
}

/** userId -> full member DTO (avatar + status) for the active workspace. */
export function useMemberMap(workspaceId: string | null): Record<string, WorkspaceMemberDTO> {
  const members = useMembers(workspaceId);
  const map: Record<string, WorkspaceMemberDTO> = {};
  for (const m of members.data ?? []) map[m.userId] = m;
  return map;
}

/** Mint a one-time agent invite code for a workspace (AGENT_MEMBERS.md):
 * the sponsor hands it to their agent, which redeems it and joins immediately. */
export function useCreateAgentInvite(workspaceId: string | null) {
  return useMutation({
    mutationFn: () => api<AgentInviteDTO>('POST', `/v1/workspaces/${workspaceId}/agent-invites`),
  });
}

/** My artifact bookmarks in a workspace (phase 9) — WS artifact.* events invalidate. */
export function useArtifacts(workspaceId: string | null) {
  return useQuery({
    queryKey: ['artifacts', workspaceId],
    queryFn: () => api<{ artifacts: ArtifactDTO[] }>('GET', `/v1/workspaces/${workspaceId}/artifacts`),
    select: (d) => d.artifacts,
    enabled: workspaceId !== null,
  });
}

/** Slack-compat apps for a workspace (phase4.md §1). Admin-only endpoint. */
export function useApps(workspaceId: string | null) {
  return useQuery({
    queryKey: ['apps', workspaceId],
    queryFn: () => api<{ apps: AppDTO[] }>('GET', `/v1/workspaces/${workspaceId}/apps`),
    select: (d) => d.apps,
    enabled: workspaceId !== null,
  });
}

/** Channel member ids — standard channels included (mention CTA, invite lists). */
export function useChannelMembers(channelId: string | null) {
  return useQuery({
    queryKey: ['channelMembers', channelId],
    queryFn: () => api<{ userIds: string[] }>('GET', `/v1/channels/${channelId}/members`),
    select: (d) => d.userIds,
    enabled: channelId !== null,
  });
}

export function useMessages(channelId: string | null) {
  return useInfiniteQuery({
    queryKey: ['messages', channelId],
    queryFn: ({ pageParam }) =>
      api<MessagePage>(
        'GET',
        `/v1/channels/${channelId}/messages?limit=50${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) =>
      last.hasMore && last.messages.length > 0 ? last.messages[last.messages.length - 1]!.id : undefined,
    enabled: channelId !== null,
  });
}

/** Flattened ascending message list from the infinite query pages. */
export function flattenMessages(pages: MessagePage[] | undefined): MessageDTO[] {
  if (!pages) return [];
  const all: MessageDTO[] = [];
  for (let i = pages.length - 1; i >= 0; i--) {
    const page = pages[i]!;
    for (let j = page.messages.length - 1; j >= 0; j--) all.push(page.messages[j]!);
  }
  return all;
}

export function useThread(rootId: string | null) {
  return useQuery({
    queryKey: ['thread', rootId],
    queryFn: () =>
      api<MessagePage & { root: MessageDTO }>('GET', `/v1/messages/${rootId}/thread?limit=200`),
    enabled: rootId !== null,
  });
}

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationPage>('GET', '/v1/me/notifications?limit=50'),
    enabled,
  });
}

export function useNotificationUnread() {
  return useQuery({
    queryKey: ['notificationUnread'],
    queryFn: () => api<NotificationPage>('GET', '/v1/me/notifications?limit=1'),
    select: (d) => d.unreadCount,
  });
}

interface SendInput {
  body: string;
  threadRootId?: string;
  fileIds?: string[];
  mentions?: string[];
  /** Full DTOs of the attached files so the optimistic row renders them. */
  files?: FileDTO[];
}
type SendVars = SendInput & { clientMsgId: string };

/** The exact outgoing vars for each in-flight/failed send, keyed by
 * clientMsgId, so Retry can replay the identical POST (mentions included —
 * those aren't recoverable from the stored wire body). Cleared on success or
 * discard; a session-scoped map (the optimistic cache is memory-only too). */
const outgoingSends = new Map<string, SendVars>();

/** Local-first send (macOS parity): a pending row lands in the cache before
 * the POST leaves; the response (or the WS echo, whichever wins) reconciles
 * it via clientMsgId. A failure flips the row to `failed` (kept in place with
 * a Retry affordance) rather than dropping it. */
export function useSendMessage(channelId: string) {
  const qc = useQueryClient();
  const auth = useAuth();
  const optimisticRow = (vars: SendVars): LocalMessage => ({
    id: pendingId(vars.clientMsgId),
    channelId,
    userId: auth.user.id,
    threadRootId: vars.threadRootId ?? null,
    clientMsgId: vars.clientMsgId,
    body: vars.body,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    systemKind: null,
    replyCount: 0,
    lastReplyAt: null,
    replyParticipantUserIds: [],
    reactions: [],
    unfurls: [], // cards arrive from the server, never optimistically
    files: vars.files ?? [],
    pending: true,
  });
  const mutation = useMutation({
    mutationFn: (vars: SendVars) =>
      api<MessageDTO>('POST', `/v1/channels/${channelId}/messages`, {
        clientMsgId: vars.clientMsgId,
        body: vars.body,
        ...(vars.threadRootId ? { threadRootId: vars.threadRootId } : {}),
        ...(vars.fileIds?.length ? { fileIds: vars.fileIds } : {}),
        ...(vars.mentions?.length ? { mentions: vars.mentions } : {}),
      }),
    onMutate: (vars) => {
      outgoingSends.set(vars.clientMsgId, vars);
      // Replaces the failed row in place on a retry (sameRow matches clientMsgId).
      applyMessageEvent(qc, optimisticRow(vars), true);
    },
    onSuccess: (msg, vars) => {
      outgoingSends.delete(vars.clientMsgId);
      applyMessageEvent(qc, msg, true);
    },
    onError: (_err, vars) => markSendFailed(qc, channelId, vars.clientMsgId, vars.threadRootId),
  });
  return {
    ...mutation,
    mutate: (input: SendInput, opts?: Parameters<typeof mutation.mutate>[1]) =>
      mutation.mutate({ ...input, clientMsgId: crypto.randomUUID() }, opts),
    /** Re-POST a failed message with its original clientMsgId (idempotent
     * server-side). Flips the row back to pending and re-bumps the rollup. */
    retry: (clientMsgId: string, opts?: Parameters<typeof mutation.mutate>[1]) => {
      const vars = outgoingSends.get(clientMsgId);
      if (vars) mutation.mutate(vars, opts);
    },
    /** Drop a failed message and forget its vars (the "×" beside Retry). */
    discard: (clientMsgId: string, threadRootId?: string) => {
      outgoingSends.delete(clientMsgId);
      removePendingMessage(qc, channelId, clientMsgId, threadRootId);
    },
  };
}

export function useToggleReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { message: MessageDTO; emoji: string; mine: boolean }) =>
      api<{ reactions: unknown }>(
        input.mine ? 'DELETE' : 'PUT',
        `/v1/messages/${input.message.id}/reactions/${encodeURIComponent(input.emoji)}`,
      ),
    onSuccess: (_r, input) => {
      void qc.invalidateQueries({ queryKey: ['messages', input.message.channelId] });
      if (input.message.threadRootId) {
        void qc.invalidateQueries({ queryKey: ['thread', input.message.threadRootId] });
      } else {
        void qc.invalidateQueries({ queryKey: ['thread', input.message.id] });
      }
    },
  });
}

/**
 * Advance the channel read cursor — which also clears that channel's Activity
 * notifications server-side (issue #63). With `threadRootId` it means "I'm
 * looking at this thread": the thread's rows go read and the channel cursor
 * (top-level only) stays put.
 */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { channelId: string; lastReadMsgId: string; threadRootId?: string }) =>
      api('POST', `/v1/channels/${input.channelId}/read`, {
        lastReadMsgId: input.lastReadMsgId,
        ...(input.threadRootId ? { threadRootId: input.threadRootId } : {}),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels'] }),
  });
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<UserDTO>('GET', '/v1/me'),
  });
}
