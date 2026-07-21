// Minimal /v1 REST client speaking the agent bearer token.
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  AgentLoginResponse,
  AgentRegisterPollResponse,
  AgentRegisterStartResponse,
  ArtifactDTO,
  ChannelDTO,
  FileDTO,
  MessageDTO,
  MessagePage,
  UserDTO,
  WorkspaceDTO,
  WorkspaceMemberDTO,
} from '@flow/shared';

const USER_MENTION_RE = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/g;

export class FlowApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FlowApiError';
  }
}

async function parseError(res: Response): Promise<never> {
  let code = 'http_error';
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
    }
  } catch {
    /* non-JSON error body */
  }
  throw new FlowApiError(res.status, code, message);
}

export class FlowApi {
  constructor(
    private readonly serverUrl: string,
    private readonly token: string,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.serverUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) await parseError(res);
    return (await res.json()) as T;
  }

  me(): Promise<UserDTO> {
    return this.req('GET', '/v1/me');
  }

  async myWorkspaces(): Promise<WorkspaceDTO[]> {
    const r = await this.req<{ workspaces: WorkspaceDTO[] }>('GET', '/v1/me/workspaces');
    return r.workspaces;
  }

  async listChannels(workspaceId: string): Promise<ChannelDTO[]> {
    const r = await this.req<{ channels: ChannelDTO[] }>('GET', `/v1/workspaces/${workspaceId}/channels`);
    return r.channels;
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMemberDTO[]> {
    const r = await this.req<{ members: WorkspaceMemberDTO[] }>('GET', `/v1/workspaces/${workspaceId}/members`);
    return r.members;
  }

  /** Post a message; mentions are parsed out of the body (server fans out notifications). */
  sendMessage(channelId: string, body: string, threadRootId?: string, fileIds?: string[]): Promise<MessageDTO> {
    const mentions = [...new Set([...body.matchAll(USER_MENTION_RE)].map((m) => m[1]!))];
    return this.req('POST', `/v1/channels/${channelId}/messages`, {
      clientMsgId: randomUUID(),
      body: body.slice(0, 12000),
      ...(threadRootId ? { threadRootId } : {}),
      ...(fileIds?.length ? { fileIds } : {}),
      ...(mentions.length ? { mentions: mentions.slice(0, 50) } : {}),
    });
  }

  editMessage(messageId: string, body: string): Promise<MessageDTO> {
    return this.req('PATCH', `/v1/messages/${messageId}`, { body: body.slice(0, 12000) });
  }

  /** `hard` purges the row (no tombstone) — used for the ephemeral "thinking…" status. */
  deleteMessage(messageId: string, opts?: { hard?: boolean }): Promise<void> {
    return this.req('DELETE', `/v1/messages/${messageId}${opts?.hard ? '?purge=true' : ''}`);
  }

  listMessages(channelId: string, limit = 50, before?: string): Promise<MessagePage> {
    return this.req('GET', `/v1/channels/${channelId}/messages?limit=${limit}${before ? `&before=${before}` : ''}`);
  }

  joinChannel(channelId: string): Promise<unknown> {
    return this.req('POST', `/v1/channels/${channelId}/join`);
  }

  leaveChannel(channelId: string): Promise<unknown> {
    return this.req('POST', `/v1/channels/${channelId}/leave`);
  }

  async listThread(rootId: string, limit = 200): Promise<MessageDTO[]> {
    const r = await this.req<{ messages: MessageDTO[] }>('GET', `/v1/messages/${rootId}/thread?limit=${limit}`);
    return r.messages;
  }

  addReaction(messageId: string, emoji: string): Promise<unknown> {
    return this.req('PUT', `/v1/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  /** Download a file attachment's original bytes (the agent is a channel member, so /v1/files authorizes it). */
  async downloadFile(fileId: string): Promise<Buffer> {
    const res = await fetch(`${this.serverUrl}/v1/files/${fileId}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) await parseError(res);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Set the agent's own avatar (server square-crops to 512px webp). */
  async setAvatar(filename: string, mimeType: string, data: Buffer): Promise<UserDTO> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)], { type: mimeType }), filename);
    const res = await fetch(`${this.serverUrl}/v1/me/avatar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}` },
      body: form,
    });
    if (!res.ok) await parseError(res);
    return (await res.json()) as UserDTO;
  }

  /** Phase 9: put an artifact bookmark of `fileId` in one person's sidebar.
   * The caller must share a channel with them and be able to read the file. */
  shareArtifactWith(userId: string, fileId: string, name?: string): Promise<ArtifactDTO> {
    return this.req('POST', '/v1/artifacts/share', { userId, fileId, ...(name ? { name } : {}) });
  }

  async uploadFile(workspaceId: string, filename: string, mimeType: string, data: Buffer): Promise<FileDTO> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)], { type: mimeType }), filename);
    const res = await fetch(`${this.serverUrl}/v1/workspaces/${workspaceId}/files`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}` },
      body: form,
    });
    if (!res.ok) await parseError(res);
    return (await res.json()) as FileDTO;
  }
}

// ---- On-demand registration (AGENT_MEMBERS.md) ------------------
// The agent registers like a person: username + secret key + a human sponsor
// (by email). The server opens a pairing request; the sponsor approves the
// matching code inside Flow while the agent polls.

/** A fresh agent secret key (the agent's password-equivalent, shown/stored once). */
export function newAgentKey(): string {
  return `flow-agent-key-${randomBytes(24).toString('base64url')}`;
}

export interface RegisterInput {
  username: string;
  key: string;
  name: string;
  sponsorEmail: string;
  description?: string;
  avatarUrl?: string;
}

/** Unauthenticated: open a pairing request → pairing code + poll credentials. */
export async function startAgentRegistration(
  serverUrl: string,
  input: RegisterInput,
): Promise<AgentRegisterStartResponse> {
  const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/v1/agents/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as AgentRegisterStartResponse;
}

export async function pollAgentRegistration(
  serverUrl: string,
  requestId: string,
  pollSecret: string,
): Promise<AgentRegisterPollResponse> {
  const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/v1/agents/register/${requestId}`, {
    headers: { authorization: `Bearer ${pollSecret}` },
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as AgentRegisterPollResponse;
}

/**
 * Poll until the sponsor resolves the request (approve/deny) or it expires.
 * The approved response carries the agent token exactly once — don't lose it
 * (recovery: `flow-agent-bridge login` with the username + key).
 */
export async function waitForApproval(
  serverUrl: string,
  start: AgentRegisterStartResponse,
): Promise<AgentRegisterPollResponse> {
  for (;;) {
    const res = await pollAgentRegistration(serverUrl, start.requestId, start.pollSecret);
    if (res.status !== 'pending') return res;
    if (Date.now() > Date.parse(start.expiresAt)) return { status: 'expired' };
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Unauthenticated: username + key → fresh agent token (revokes prior tokens). */
export async function agentLogin(serverUrl: string, username: string, key: string): Promise<AgentLoginResponse> {
  const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/v1/agents/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, key }),
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as AgentLoginResponse;
}
