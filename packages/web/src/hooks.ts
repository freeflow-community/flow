// TanStack Query hooks over the REST API (phase2.md §7: online-only —
// queries are the state; WS events invalidate them).
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  AgentPairingRequestDTO,
  AppDTO,
  ChannelDTO,
  FileDTO,
  MessageDTO,
  MessagePage,
  NotificationPage,
  UserDTO,
  WorkspaceDTO,
  WorkspaceMemberDTO,
} from '@flow/shared';
import { api } from './lib/api';
import {
  applyMessageEvent,
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

/** Pending agent pairing requests naming me as sponsor (AGENT_MEMBERS.md).
 * WS `agent.pairing` events invalidate this; the interval catches expiry. */
export function useAgentRequests() {
  return useQuery({
    queryKey: ['agentRequests'],
    queryFn: () => api<{ requests: AgentPairingRequestDTO[] }>('GET', '/v1/me/agent-requests'),
    select: (d) => d.requests,
    refetchInterval: 60_000,
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

/** Local-first send (macOS parity): a pending row lands in the cache before
 * the POST leaves; the response (or the WS echo, whichever wins) reconciles
 * it via clientMsgId; a failure removes it and the composer shows the error. */
export function useSendMessage(channelId: string) {
  const qc = useQueryClient();
  const auth = useAuth();
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
      const optimistic: LocalMessage = {
        id: pendingId(vars.clientMsgId),
        channelId,
        userId: auth.user.id,
        threadRootId: vars.threadRootId ?? null,
        clientMsgId: vars.clientMsgId,
        body: vars.body,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        replyCount: 0,
        lastReplyAt: null,
        replyParticipantUserIds: [],
        reactions: [],
        files: vars.files ?? [],
        pending: true,
      };
      applyMessageEvent(qc, optimistic, true);
    },
    onSuccess: (msg) => applyMessageEvent(qc, msg, true),
    onError: (_err, vars) => removePendingMessage(qc, channelId, vars.clientMsgId, vars.threadRootId),
  });
  return {
    ...mutation,
    mutate: (input: SendInput, opts?: Parameters<typeof mutation.mutate>[1]) =>
      mutation.mutate({ ...input, clientMsgId: crypto.randomUUID() }, opts),
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

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { channelId: string; lastReadMsgId: string }) =>
      api('POST', `/v1/channels/${input.channelId}/read`, { lastReadMsgId: input.lastReadMsgId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels'] }),
  });
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<UserDTO>('GET', '/v1/me'),
  });
}
