import type { ArtifactDTO } from '@flow/shared';

export function shouldOpenArtifact(artifact: ArtifactDTO, userId: string, channelId: string | null, threadRootId: string | null): boolean {
  return artifact.requesterUserId === userId && artifact.channelId === channelId
    && (artifact.sourceThreadRootId ?? null) === threadRootId;
}
