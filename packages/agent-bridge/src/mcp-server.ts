// The `flow` MCP stdio server (rich mode, operator ruling 6): messaging
// (send_message, react, upload_file, search_history), the key channel
// operations (list_channels, list_users, join_channel, leave_channel,
// create_channel, invite_to_channel, read_messages), and self-service profile
// bits (set_avatar) against /v1
// with the agent token.
//
// Hand-rolled newline-delimited JSON-RPC (the MCP stdio transport) — a small
// fixed tool surface; no SDK dependency needed. Conversation context
// (channel/thread) arrives via env from the bridge's per-run --mcp-config.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { FlowApi, FlowApiError } from './api.js';
import { attachmentFilename, formatAttachments } from './attachments.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

/** How a channel is named in tool output — DMs have no name, only a kind. */
const channelLabel = (c: { name: string | null; kind: string }): string =>
  c.name ? `#${c.name}` : `(${c.kind})`;

/** Lease for an indicator set by hand via set_channel_indicator (#137). Longer
 * than the per-turn one, because nothing refreshes this one — but still bounded,
 * so an agent that forgets to clear it doesn't leave a channel spinning. */
const MANUAL_INDICATOR_TTL_SECONDS = 300;

const TOOLS = [
  {
    name: 'send_message',
    description:
      'Send a message to a Flow channel or thread immediately. Defaults to the current conversation. Mention users as <@userId>.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Message body (markdown).' },
        channelId: { type: 'string', description: 'Target channel id (default: current conversation).' },
        threadRootId: { type: 'string', description: 'Thread root message id (default: current thread, if any).' },
      },
      required: ['text'],
    },
  },
  {
    name: 'react',
    description: 'Add an emoji reaction to a message.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'Message id to react to.' },
        emoji: { type: 'string', description: 'A single unicode emoji, e.g. 👍' },
      },
      required: ['messageId', 'emoji'],
    },
  },
  {
    name: 'upload_file',
    description: 'Upload a local file and post it to a Flow channel (defaults to the current conversation).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file on disk.' },
        channelId: { type: 'string', description: 'Target channel id (default: current conversation).' },
        threadRootId: { type: 'string', description: 'Thread root message id (default: current thread, if any).' },
        comment: { type: 'string', description: 'Optional message text to accompany the file.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_history',
    description: 'Search recent messages in a Flow channel for a substring (case-insensitive).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for.' },
        channelId: { type: 'string', description: 'Channel to search (default: current conversation).' },
        limit: { type: 'number', description: 'Max matches to return (default 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_channels',
    description: 'List channels in the workspace (id, name, kind, private/member flags, topic).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_users',
    description: 'List workspace members (id, display name, role; 🤖 marks agents). Use the ids in <@userId> mentions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'join_channel',
    description: 'Join a public channel by id (required before reading or posting in channels you are not a member of).',
    inputSchema: {
      type: 'object',
      properties: { channelId: { type: 'string', description: 'Channel id to join.' } },
      required: ['channelId'],
    },
  },
  {
    name: 'set_channel_indicator',
    description:
      "Show or hide the small spinner on a channel's sidebar row, marking it as one you are actively working in. " +
      'The bridge already does this for the channel you were asked in, for as long as the turn runs — use this only ' +
      'to mark a *different* channel busy (e.g. one you handed work off to). It lapses on its own after five minutes ' +
      'unless you set it again, so clear it when the work is done rather than relying on that.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['busy', 'none'], description: "'busy' spins the row, 'none' stops it." },
        channelId: { type: 'string', description: 'Channel id (default: current conversation).' },
      },
      required: ['state'],
    },
  },
  {
    name: 'leave_channel',
    description: 'Leave a channel by id.',
    inputSchema: {
      type: 'object',
      properties: { channelId: { type: 'string', description: 'Channel id to leave.' } },
      required: ['channelId'],
    },
  },
  {
    name: 'create_channel',
    description:
      'Create a new channel in the workspace and join it. Names are lowercase letters, digits, - and _ (max 80 chars). Returns the new channel id — use it with invite_to_channel and send_message.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Channel name without the #, e.g. incident-2026-07-25.' },
        topic: { type: 'string', description: 'Optional channel topic (max 250 chars).' },
        isPrivate: {
          type: 'boolean',
          description: 'Private channel — visible only to its members (default false).',
        },
        parentId: {
          type: 'string',
          description:
            'Nest the new channel under this existing channel or DM — it shows indented beneath it in the sidebar. You must be a member of the parent, it must not be archived, and it must not already be a sub-channel (one level only). Nesting under a DM makes the new channel private and adds everyone in that DM, so it is the place to put a long build log or working notes without filling the conversation. Get ids from list_channels.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'start_task',
    description:
      'Hand off long-running work (a ticket, a build, a multi-step job) to a separate run of yourself homed in another channel, and return immediately — use it when a requester should not have to wait in this conversation. The new run starts fresh with your prompt as its ONLY instructions: it inherits nothing from here, so make the prompt self-contained (the goal, ids, who asked and their <@userId>, where to report back). The target channel becomes the run’s conversation — its progress indicator, messages and final reply post there top-level, and anyone who talks in that channel is talking to the run with its full context. Typical shape: create_channel + invite_to_channel first, then start_task, then reply here with a one-line pointer to the channel. Do NOT do the work yourself after a successful handoff.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'Channel to home the run in — you must be a member (typically one you just created).',
        },
        prompt: {
          type: 'string',
          description: 'Complete, self-contained instructions for the run. It does not see this conversation.',
        },
      },
      required: ['channelId', 'prompt'],
    },
  },
  {
    name: 'invite_to_channel',
    description:
      'Add workspace members to a channel. Pass several userIds to invite a group in one call — each is added independently and the result reports any that failed. Get ids from list_users.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Channel to add people to (default: current conversation).' },
        userIds: { type: 'array', items: { type: 'string' }, description: 'User ids to add.' },
      },
      required: ['userIds'],
    },
  },
  {
    name: 'set_avatar',
    description:
      'Set your own avatar from a local image file (png/jpeg/gif/webp — the server square-crops it to 512px).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path to the image file on disk.' } },
      required: ['path'],
    },
  },
  {
    name: 'create_artifact',
    description:
      'Create an artifact — a named file pinned to a channel and shared with everyone in it. It opens in the side panel and nests under the channel in the sidebar. Provide the content inline, or a local file path, or the id of an already-uploaded file. Returns the artifact id (use it with update_artifact).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the artifact (defaults to the file name).' },
        content: { type: 'string', description: 'Inline file content to upload (use with name; mimeType recommended).' },
        mimeType: { type: 'string', description: 'Mime type for inline content (default text/plain; use text/html for HTML artifacts).' },
        path: { type: 'string', description: 'Path to a local file to upload instead of inline content.' },
        fileId: { type: 'string', description: 'Id of a file already uploaded/shared in Flow to pin as-is.' },
        channelId: { type: 'string', description: 'Channel to pin the artifact in (default: the current conversation).' },
      },
    },
  },
  {
    name: 'update_artifact',
    description:
      'Update an existing artifact in place — rename it and/or replace its content. Everyone viewing it sees the new version. Provide new content inline, a local file path, or the id of an already-uploaded file to replace the backing file; and/or a new name.',
    inputSchema: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: 'Id of the artifact to update (from create_artifact).' },
        name: { type: 'string', description: 'New display name (optional).' },
        content: { type: 'string', description: 'New inline content to replace the file with (mimeType recommended).' },
        mimeType: { type: 'string', description: 'Mime type for inline content (default text/plain; use text/html for HTML).' },
        path: { type: 'string', description: 'Path to a local file whose contents replace the artifact.' },
        fileId: { type: 'string', description: 'Id of an already-uploaded file to point the artifact at.' },
      },
      required: ['artifactId'],
    },
  },
  {
    name: 'read_messages',
    description:
      'Read messages from a channel, newest first. Page backwards by passing `before` = the oldest message id from the previous page. Messages with attachments list them as `[attachments: <fileId> "name" (type, size)]` — pass a file id to download_file to fetch the bytes.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Channel to read (default: current conversation).' },
        limit: { type: 'number', description: 'Messages per page (default 25, max 200).' },
        before: { type: 'string', description: 'Only messages older than this message id (paging cursor).' },
      },
    },
  },
  {
    name: 'download_file',
    description:
      'Download a file attached to a Flow message to a local path, and return that path (Read it to view the contents; images render). Take the file id from the [attachments: …] note on a read_messages or search_history line.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'Id of the file to download.' },
        path: {
          type: 'string',
          description: 'Where to write it (default: a temp file named after the attachment).',
        },
      },
      required: ['fileId'],
    },
  },
];

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.csv': 'text/csv',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

/** Per-user failure text for invite_to_channel. The server's own messages are
 * already agent-readable (`dm_channel`, `channel_archived`, `bad_user`), so
 * they pass through — except 404, which a private channel the agent isn't in
 * also returns (membership privacy), making "channel not found" misleading. */
function inviteErrorText(err: unknown): string {
  if (!(err instanceof FlowApiError)) return (err as Error).message;
  if (err.status === 404) {
    return 'channel not found, or it is private and you are not a member (only members can invite to a private channel)';
  }
  return err.message;
}

/** POST JSON to the bridge daemon over its local task socket (FLOW_BRIDGE_SOCK). */
function bridgeIpcPost(
  socketPath: string,
  payload: unknown,
): Promise<{ ok: true; note: string } | { error: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      { socketPath, path: '/task', method: 'POST', headers: { 'content-type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as { ok: true; note: string } | { error: string });
          } catch {
            reject(new Error(`bad bridge response (status ${res.statusCode})`));
          }
        });
      },
    );
    req.setTimeout(10_000, () => req.destroy(new Error('bridge did not answer within 10s')));
    req.on('error', reject);
    req.end(body);
  });
}

export async function runMcpServer(): Promise<void> {
  const serverUrl = process.env.FLOW_SERVER_URL ?? '';
  const token = process.env.FLOW_AGENT_TOKEN ?? '';
  const workspaceId = process.env.FLOW_WORKSPACE_ID ?? '';
  const defaultChannelId = process.env.FLOW_CHANNEL_ID ?? '';
  const defaultThreadRootId = process.env.FLOW_THREAD_ROOT_ID || undefined;
  if (!serverUrl || !token) {
    process.stderr.write('flow mcp: FLOW_SERVER_URL and FLOW_AGENT_TOKEN are required\n');
    process.exit(1);
  }
  const api = new FlowApi(serverUrl, token);

  const write = (msg: unknown): void => {
    process.stdout.write(`${JSON.stringify(msg)}\n`);
  };
  const reply = (id: number | string | null, result: unknown): void => {
    write({ jsonrpc: '2.0', id, result });
  };
  const replyError = (id: number | string | null, code: number, message: string): void => {
    write({ jsonrpc: '2.0', id, error: { code, message } });
  };
  const toolText = (text: string, isError = false) => ({ content: [{ type: 'text', text }], isError });

  /** Resolve artifact args to a file id: an existing `fileId` (pinned as-is,
   * ownsFile=false), or a `path`/`content` upload (owned by the artifact,
   * ownsFile=true). Returns `{ error: true }` when no source was given. */
  async function resolveArtifactFile(
    args: Record<string, unknown>,
    label: string | undefined,
  ): Promise<{ fileId: string; label: string | undefined; ownsFile: boolean } | { error: true }> {
    const existing = (args.fileId as string | undefined) || '';
    if (existing) return { fileId: existing, label, ownsFile: false };
    let filename: string;
    let mime: string;
    let data: Buffer;
    if (args.path) {
      const p = path.resolve(String(args.path));
      data = fs.readFileSync(p);
      filename = path.basename(p);
      mime = String(args.mimeType ?? '') || MIME_BY_EXT[path.extname(p).toLowerCase()] || 'application/octet-stream';
    } else if (typeof args.content === 'string') {
      filename = label ?? 'artifact.txt';
      mime = String(args.mimeType ?? '') || 'text/plain';
      data = Buffer.from(args.content, 'utf8');
    } else {
      return { error: true };
    }
    const file = await api.uploadFile(workspaceId, filename, mime, data);
    return { fileId: file.id, label: label ?? filename, ownsFile: true };
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const channelId = (args.channelId as string | undefined) || defaultChannelId;
    const threadRootId = (args.threadRootId as string | undefined) || defaultThreadRootId;
    switch (name) {
      case 'send_message': {
        const msg = await api.sendMessage(channelId, String(args.text ?? ''), threadRootId);
        return toolText(`sent (message id ${msg.id})`);
      }
      case 'react': {
        await api.addReaction(String(args.messageId ?? ''), String(args.emoji ?? ''));
        return toolText('reaction added');
      }
      case 'upload_file': {
        const p = path.resolve(String(args.path ?? ''));
        const data = fs.readFileSync(p);
        const filename = path.basename(p);
        const mime = MIME_BY_EXT[path.extname(p).toLowerCase()] ?? 'application/octet-stream';
        const file = await api.uploadFile(workspaceId, filename, mime, data);
        const msg = await api.sendMessage(channelId, String(args.comment ?? filename), threadRootId, [file.id]);
        return toolText(`uploaded ${filename} (message id ${msg.id})`);
      }
      case 'search_history': {
        const q = String(args.query ?? '').toLowerCase();
        const limit = Math.min(Number(args.limit ?? 10), 50);
        const page = await api.listMessages(channelId, 200);
        const hits = page.messages
          .filter((m) => !m.deletedAt && m.body.toLowerCase().includes(q))
          .slice(-limit)
          .map((m) => `[${m.createdAt} <@${m.userId}> msg ${m.id}] ${m.body.slice(0, 300)}${formatAttachments(m.files)}`);
        return toolText(hits.length ? hits.join('\n') : 'no matches');
      }
      case 'list_channels': {
        const channels = await api.listChannels(workspaceId);
        const labelById = new Map(channels.map((c) => [c.id, channelLabel(c)]));
        const lines = channels
          .filter((c) => !c.archivedAt)
          .map((c) => {
            const flags = [c.isPrivate ? 'private' : 'public', c.isMember ? 'member' : 'not-member'].join(', ');
            const label = channelLabel(c);
            // Show the parent by name so an agent can see the nesting without
            // cross-referencing ids itself.
            const under = c.parentId ? `  under ${labelById.get(c.parentId) ?? c.parentId}` : '';
            return `${c.id}  ${label}  [${flags}]${under}${c.topic ? ` — ${c.topic}` : ''}`;
          });
        return toolText(lines.length ? lines.join('\n') : 'no channels');
      }
      case 'list_users': {
        const members = await api.listMembers(workspaceId);
        const lines = members.map(
          (m) => `${m.userId}  ${m.displayName}${m.isAgent ? ' 🤖' : ''}  [${m.role}]${m.statusText ? ` — ${m.statusText}` : ''}`,
        );
        return toolText(lines.join('\n'));
      }
      case 'join_channel': {
        await api.joinChannel(String(args.channelId ?? ''));
        return toolText('joined');
      }
      case 'leave_channel': {
        await api.leaveChannel(String(args.channelId ?? ''));
        return toolText('left');
      }
      case 'set_channel_indicator': {
        const state = String(args.state ?? '');
        if (state !== 'busy' && state !== 'none') {
          return toolText("set_channel_indicator needs state 'busy' or 'none'", true);
        }
        const target = args.channelId ? String(args.channelId) : channelId;
        // Nothing refreshes a hand-set indicator, so it gets a longer lease
        // than the per-turn one the reporter keeps alive.
        await api.setChannelIndicator(target, state, MANUAL_INDICATOR_TTL_SECONDS);
        return toolText(state === 'busy' ? 'channel marked busy' : 'channel indicator cleared');
      }
      case 'create_channel': {
        const name = String(args.name ?? '').trim();
        if (!name) return toolText('create_channel needs a name', true);
        try {
          const created = await api.createChannel(workspaceId, {
            name,
            ...(args.topic ? { topic: String(args.topic) } : {}),
            ...(args.isPrivate === true ? { isPrivate: true } : {}),
            ...(args.parentId ? { parentId: String(args.parentId) } : {}),
          });
          // Name the parent rather than echo its id back — the agent passed the
          // id in, so repeating it says nothing about whether nesting worked.
          const parentLabel = created.parentId
            ? await api
                .listChannels(workspaceId)
                .then((cs) => {
                  const p = cs.find((c) => c.id === created.parentId);
                  return p ? channelLabel(p) : undefined;
                })
                .catch(() => undefined)
            : undefined;
          const nested = created.parentId ? ` — under ${parentLabel ?? created.parentId}` : '';
          return toolText(
            `created #${created.name} (id ${created.id})${created.isPrivate ? ' — private' : ''}${nested}; you are a member`,
          );
        } catch (err) {
          if (err instanceof FlowApiError && err.code === 'channel_exists') {
            // hand back the existing id when we can see it, so the agent can just use it
            const existing = await api
              .listChannels(workspaceId)
              .then((cs) => cs.find((c) => c.name === name))
              .catch(() => undefined);
            return toolText(
              existing
                ? `a channel named #${name} already exists (id ${existing.id}) — use it instead of creating one`
                : `a channel named #${name} already exists`,
              true,
            );
          }
          throw err;
        }
      }
      case 'start_task': {
        const sock = process.env.FLOW_BRIDGE_SOCK || '';
        if (!sock) {
          return toolText(
            'start_task is unavailable (no bridge daemon behind this run) — do the work in this conversation instead',
            true,
          );
        }
        const target = String(args.channelId ?? '').trim();
        const prompt = String(args.prompt ?? '').trim();
        if (!target || !prompt) return toolText('start_task needs channelId and prompt', true);
        try {
          const out = await bridgeIpcPost(sock, {
            channelId: target,
            prompt,
            userId: process.env.FLOW_USER_ID || '',
            sourceChannelId: defaultChannelId,
          });
          if ('error' in out) return toolText(`start_task failed: ${out.error}`, true);
          return toolText(
            `${out.note}. The run works there on its own — post a one-line pointer for the requester here and end this turn; don't do the task yourself.`,
          );
        } catch (err) {
          return toolText(
            `start_task failed: ${(err as Error).message} — do the work in this conversation instead`,
            true,
          );
        }
      }
      case 'invite_to_channel': {
        if (!channelId) return toolText('invite_to_channel needs a channelId', true);
        const raw = Array.isArray(args.userIds)
          ? args.userIds
          : [args.userIds ?? args.userId].filter((v) => v !== undefined && v !== null);
        const userIds = [...new Set(raw.map((u) => String(u).trim()).filter(Boolean))].slice(0, 50);
        if (userIds.length === 0) return toolText('invite_to_channel needs one or more userIds', true);
        // one call per user (the server adds one at a time); report each outcome
        const added: string[] = [];
        const failed: string[] = [];
        for (const userId of userIds) {
          try {
            await api.addChannelMember(channelId, userId);
            added.push(userId);
          } catch (err) {
            failed.push(`<@${userId}>: ${inviteErrorText(err)}`);
          }
        }
        const summary = added.length ? `invited ${added.map((u) => `<@${u}>`).join(', ')}` : 'invited nobody';
        const detail = failed.length ? `\nfailed:\n${failed.join('\n')}` : '';
        return toolText(summary + detail, added.length === 0);
      }
      case 'set_avatar': {
        const p = path.resolve(String(args.path ?? ''));
        const mime = MIME_BY_EXT[path.extname(p).toLowerCase()] ?? '';
        if (!mime.startsWith('image/')) return toolText('set_avatar needs a png/jpeg/gif/webp image', true);
        await api.setAvatar(path.basename(p), mime, fs.readFileSync(p));
        return toolText('avatar updated');
      }
      case 'create_artifact': {
        if (!channelId) {
          return toolText('create_artifact needs a channelId (no conversation context to infer the channel)', true);
        }
        // resolve a file id: pin an existing file, or upload path/content (owned)
        const resolved = await resolveArtifactFile(args, (args.name as string | undefined) || undefined);
        if ('error' in resolved) return toolText(`create_artifact needs one of: content, path, or fileId`, true);
        const created = await api.createArtifact(channelId, resolved.fileId, resolved.label, resolved.ownsFile);
        return toolText(`artifact "${created.name}" created (id ${created.id})`);
      }
      case 'update_artifact': {
        const artifactId = (args.artifactId as string | undefined) || '';
        if (!artifactId) return toolText('update_artifact needs an artifactId', true);
        const name = (args.name as string | undefined) || undefined;
        const hasNewContent = args.fileId || args.path || typeof args.content === 'string';
        if (!name && !hasNewContent) {
          return toolText('update_artifact needs a name and/or new content (content, path, or fileId)', true);
        }
        const patch: { name?: string; fileId?: string; ownsFile?: boolean } = {};
        if (name) patch.name = name;
        if (hasNewContent) {
          const resolved = await resolveArtifactFile(args, name);
          if ('error' in resolved) return toolText('update_artifact could not read the new content', true);
          patch.fileId = resolved.fileId;
          patch.ownsFile = resolved.ownsFile;
        }
        const updated = await api.updateArtifact(artifactId, patch);
        return toolText(`artifact "${updated.name}" updated`);
      }
      case 'read_messages': {
        const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 200);
        const before = (args.before as string | undefined) || undefined;
        const page = await api.listMessages(channelId, limit, before);
        // newest first, regardless of server response order (uuidv7 ids sort by time)
        const msgs = [...page.messages].sort((a, b) => (a.id < b.id ? 1 : -1));
        if (msgs.length === 0) return toolText('no messages');
        const oldest = msgs[msgs.length - 1]!;
        const lines = msgs.map(
          (m) =>
            `[${m.createdAt} <@${m.userId}> msg ${m.id}]${m.threadRootId ? ` (in thread ${m.threadRootId})` : ''} ${m.deletedAt ? '(deleted)' : m.body.slice(0, 500) + formatAttachments(m.files)}`,
        );
        const footer = page.hasMore ? `\n(more — pass before=${oldest.id} for the next page)` : '';
        return toolText(lines.join('\n') + footer);
      }
      case 'download_file': {
        const fileId = String(args.fileId ?? '');
        if (!fileId) return toolText('download_file needs a fileId (from an [attachments: …] note)', true);
        const file = await api.downloadFileWithMeta(fileId);
        const dest = args.path
          ? path.resolve(String(args.path))
          : path.join(os.tmpdir(), 'flow-attachments', attachmentFilename(fileId, file.filename));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, file.data, { mode: 0o600 });
        return toolText(`${dest} (${file.mimeType ?? 'unknown type'}, ${file.data.length} bytes)`);
      }
      default:
        return toolText(`unknown tool: ${name}`, true);
    }
  }

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    void (async () => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        return; // not for us
      }
      const id = req.id ?? null;
      try {
        switch (req.method) {
          case 'initialize':
            return reply(id, {
              protocolVersion: (req.params?.protocolVersion as string) ?? '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'flow', version: '0.1.0' },
            });
          case 'notifications/initialized':
          case 'notifications/cancelled':
            return; // notifications get no response
          case 'ping':
            return reply(id, {});
          case 'tools/list':
            return reply(id, { tools: TOOLS });
          case 'tools/call': {
            const name = String(req.params?.name ?? '');
            const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
            try {
              return reply(id, await callTool(name, args));
            } catch (err) {
              return reply(id, toolText(`error: ${(err as Error).message}`, true));
            }
          }
          default:
            if (id !== null) replyError(id, -32601, `method not found: ${req.method}`);
            return;
        }
      } catch (err) {
        if (id !== null) replyError(id, -32603, (err as Error).message);
      }
    })();
  });
  // stay alive until stdin closes
  await new Promise<void>((resolve) => rl.on('close', resolve));
}
