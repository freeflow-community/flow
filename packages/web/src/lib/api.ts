// REST client for the *active* connection.
//
// The client is per-connection now (see `connectionRuntime.ts`): every request,
// blob cache and object URL belongs to one backend session, resolves against
// that backend's origin, and carries its bearer only there. These module-level
// helpers are the single-connection view of that — they delegate to whichever
// runtime is active, which is what a component with no explicit connection
// context still means. Components that hold a context call the runtime
// directly; `useRuntime()` in `state.tsx` is how they get one.
import type { AppTokenDTO, FileDTO, WorkspaceDTO } from '@flow/shared';
import { activeRuntime, connectionManager } from './connectionRuntime';

export { ApiError, ForeignOriginError, type FileImageVariant } from './connectionRuntime';
export type { ConnectionRuntime } from './connectionRuntime';
import type { FileImageVariant } from './connectionRuntime';

export function getToken(): string | null {
  return activeRuntime().getToken();
}

/** Replace the active connection's bearer. The auth generation moves with it,
 * so a 401 from a request issued before this call is ignored rather than
 * signing the new session out. */
export function setToken(token: string | null): void {
  const runtime = activeRuntime();
  const generation = runtime.setToken(token);
  connectionManager().noteTokenReplaced(runtime.connectionId, generation);
}

export function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  return activeRuntime().api<T>(method, path, body);
}

/** Mini apps (docs/design/MINI_APPS.md): mint a 5-minute, single-use identity
 * token for the signed-in member against an `isApp` link artifact. The token is
 * appended to the app's url at load time and never stored — the artifact's
 * shared url stays clean, and a reload mints a fresh one. Throws ApiError when
 * the caller is no longer a member or the artifact is gone. */
export function mintAppToken(artifactId: string): Promise<AppTokenDTO> {
  return activeRuntime().mintAppToken(artifactId);
}

/** Streaming URL for in-place playback (<video src>): a long-TTL presigned R2
 * URL, or null when the server must proxy (local dev / legacy rows) — callers
 * fall back to blobUrl(). Not cached: each call mints a fresh TTL. */
export function fileStreamUrl(fileId: string): Promise<{ url: string | null; expiresInSeconds: number }> {
  return activeRuntime().fileStreamUrl(fileId);
}

/** Short-lived thumbnail URL for direct use by <img>, or null when the server
 * must proxy (local dev / legacy rows). Like fileStreamUrl, each call mints a
 * fresh URL so a retry does not reuse an expired presign. */
export function fileThumbUrl(fileId: string): Promise<{ url: string | null; expiresInSeconds: number }> {
  return activeRuntime().fileThumbUrl(fileId);
}

/** Resolve an access-checked file URL that an image element can load itself.
 * R2-backed files use a direct presigned URL; local and legacy rows retain the
 * authenticated object-URL fallback. */
export function fileImageUrl(fileId: string, variant: FileImageVariant): Promise<string> {
  return activeRuntime().fileImageUrl(fileId, variant);
}

/** Presigned upload: prepare (downscale/convert oversized images) → reserve →
 * PUT the bytes (direct to R2, or the server-proxied fallback in local dev) →
 * complete (server verifies + thumbnails).
 *
 * `prepareImageForUpload` sits at this one funnel rather than at each composer
 * call site, the rule the native clients settled on in #84: it can't be
 * forgotten by a new caller, and the presign has to see the *final* size. */
export function uploadFile(workspaceId: string, original: File): Promise<FileDTO> {
  return activeRuntime().uploadFile(workspaceId, original);
}

export function uploadAvatar(file: File): Promise<unknown> {
  return activeRuntime().uploadAvatar(file);
}

/** Workspace avatar (#336) — owner/admin only; the response is the updated
 * workspace, and every other client hears about it on `workspace.updated`. */
export function uploadWorkspaceAvatar(workspaceId: string, file: File): Promise<WorkspaceDTO> {
  return activeRuntime().uploadWorkspaceAvatar(workspaceId, file);
}

// Authenticated blobs (<img> can't send Authorization): fetch → object URL.
// File/thumb/avatar URLs are immutable per key, so cache forever — but the
// cache lives on the runtime, so the same path on two backends is two entries
// and disposing one connection revokes only its own object URLs.
export function cachedBlobUrl(path: string): string | undefined {
  return activeRuntime().cachedBlobUrl(path);
}

export function blobUrl(path: string): Promise<string> {
  return activeRuntime().blobUrl(path);
}

/** Authenticated text fetch for inline file previews (same immutable-URL cache). */
export function fileText(path: string): Promise<string> {
  return activeRuntime().fileText(path);
}

/** Storage key for a per-session artifact (drafts, nav, read markers) on the
 * active connection. Callers that persist anything user-scoped go through this
 * rather than naming a bare `flow.*` key, so a second connection cannot read or
 * overwrite the first one's state. */
export function scopedStorageKey(name: string): string {
  return activeRuntime().key(name);
}
