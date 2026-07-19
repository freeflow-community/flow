// TanStack Query hooks over the REST API (phase2.md §7: online-only —
// queries are the state; WS events invalidate them).
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  AppDTO,
  ChannelDTO,
  MessageDTO,
  MessagePage,
  NotificationPage,
  UserDTO,
  WorkspaceDTO,
  WorkspaceMemberDTO,
} from '@flow/shared';
import { api } from './lib/api';

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

/** userId -> full member DTO (avatar + status) for the active workspace. */
export function useMemberMap(workspaceId: string | null): Record<string, WorkspaceMemberDTO> {
  const members = useMembers(workspaceId);
  const map: Record<string, WorkspaceMemberDTO> = {};
  for (const m of members.data ?? []) map[m.userId] = m;
  return map;
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

export function useSendMessage(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; threadRootId?: string; fileIds?: string[]; mentions?: string[] }) =>
      api<MessageDTO>('POST', `/v1/channels/${channelId}/messages`, {
        clientMsgId: crypto.randomUUID(),
        body: input.body,
        ...(input.threadRootId ? { threadRootId: input.threadRootId } : {}),
        ...(input.fileIds?.length ? { fileIds: input.fileIds } : {}),
        ...(input.mentions?.length ? { mentions: input.mentions } : {}),
      }),
    onSuccess: (_msg, input) => {
      void qc.invalidateQueries({ queryKey: ['messages', channelId] });
      if (input.threadRootId) void qc.invalidateQueries({ queryKey: ['thread', input.threadRootId] });
    },
  });
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
