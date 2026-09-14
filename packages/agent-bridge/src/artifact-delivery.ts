import { createHash } from 'node:crypto';
import type { ArtifactDTO } from '@flow/shared';
import type { FlowApi } from './api.js';

/** Stable UUID for a logical delivery or its message; retries survive MCP restarts. */
export function deliveryId(...parts: string[]): string {
  const hex = createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function inlineArtifactFile(name: string | undefined, mimeType?: string, filename?: string) {
  const mime = mimeType || (/\.html?$/i.test(filename ?? name ?? '') ? 'text/html' : 'text/markdown');
  const extension = mime === 'text/html' ? '.html' : mime === 'text/markdown' ? '.md' : '.txt';
  const base = (filename || name || 'report').replace(/[\\/\r\n]/g, '-');
  return { filename: /\.[a-z0-9]+$/i.test(base) ? base : `${base}${extension}`, mime };
}

/** Delivery is acknowledged only after the durable message has been saved.
 * A failed message POST includes the saved ID and can be retried independently. */
export async function deliverArtifact(
  api: Pick<FlowApi, 'sendMessage'>,
  artifact: ArtifactDTO,
  threadRootId?: string,
  completionHint?: string,
) {
  const title = artifact.name.replace(/[\[\]\r\n]/g, ' ').trim() || 'Report';
  const body = `[Open report: ${title}](flow-artifact:${artifact.id})`;
  const clientMsgId = deliveryId('artifact-card', artifact.id, artifact.channelId, threadRootId ?? '');
  try {
    const message = await api.sendMessage(artifact.channelId, body, threadRootId, undefined, clientMsgId);
    return {
      content: [{ type: 'text', text: `Report "${artifact.name}" saved and delivered. The Open report card is in the conversation.${completionHint ? ` ${completionHint}` : ''} Do not claim the client has rendered it; client rendering has not been observed.` }],
      structuredContent: { artifactId: artifact.id, channelId: artifact.channelId, messageId: message.id, status: 'delivered' },
      isError: false,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Report saved (artifact id ${artifact.id}), but its Open report card could not be delivered: ${(error as Error).message}. Retry with deliver_artifact and this artifactId; do not create another report or claim delivery is complete.` }],
      structuredContent: { artifactId: artifact.id, channelId: artifact.channelId, status: 'delivery_failed' },
      isError: true,
    };
  }
}
