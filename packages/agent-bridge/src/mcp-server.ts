// The `flow` MCP stdio server (rich mode, operator ruling 6): send_message,
// react, upload_file, search_history against /v1 with the agent token.
//
// Hand-rolled newline-delimited JSON-RPC (the MCP stdio transport) — the
// surface is four tools; no SDK dependency needed. Conversation context
// (channel/thread) arrives via env from the bridge's per-run --mcp-config.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { FlowApi } from './api.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

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
};

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
          .map((m) => `[${m.createdAt} <@${m.userId}> msg ${m.id}] ${m.body.slice(0, 300)}`);
        return toolText(hits.length ? hits.join('\n') : 'no matches');
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
