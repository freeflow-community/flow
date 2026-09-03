// REST client: same-origin (Vite proxy in dev, Fastify static in prod).
import type { AppTokenDTO, FileDTO, PresignedUploadDTO, WorkspaceDTO } from '@flow/shared';
import { prepareImageForUpload } from './imagePrep';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'flow.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { code: string; message: string } }).error;
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

/** Mini apps (docs/design/MINI_APPS.md): mint a 5-minute, single-use identity
 * token for the signed-in member against an `isApp` link artifact. The token is
 * appended to the app's url at load time and never stored — the artifact's
 * shared url stays clean, and a reload mints a fresh one. Throws ApiError when
 * the caller is no longer a member or the artifact is gone. */
export function mintAppToken(artifactId: string): Promise<AppTokenDTO> {
  return api('POST', `/v1/artifacts/${artifactId}/app-token`);
}

/** Streaming URL for in-place playback (<video src>): a long-TTL presigned R2
 * URL, or null when the server must proxy (local dev / legacy rows) — callers
 * fall back to blobUrl(). Not cached: each call mints a fresh TTL. */
export function fileStreamUrl(fileId: string): Promise<{ url: string | null; expiresInSeconds: number }> {
  return api('GET', `/v1/files/${fileId}/url`);
}

/** Short-lived thumbnail URL for direct use by <img>, or null when the server
 * must proxy (local dev / legacy rows). Like fileStreamUrl, each call mints a
 * fresh URL so a retry does not reuse an expired presign. */
export function fileThumbUrl(fileId: string): Promise<{ url: string | null; expiresInSeconds: number }> {
  return api('GET', `/v1/files/${fileId}/thumb/url`);
}

export type FileImageVariant = 'thumbnail' | 'original';

/** Resolve an access-checked file URL that an image element can load itself.
 * R2-backed files use a direct presigned URL; local and legacy rows retain the
 * authenticated object-URL fallback. */
export async function fileImageUrl(fileId: string, variant: FileImageVariant): Promise<string> {
  const direct = variant === 'thumbnail' ? await fileThumbUrl(fileId) : await fileStreamUrl(fileId);
  if (direct.url) return direct.url;
  const suffix = variant === 'thumbnail' ? '/thumb' : '';
  return blobUrl(`/v1/files/${fileId}${suffix}`);
}

/** Presigned upload: prepare (downscale/convert oversized images) → reserve →
 * PUT the bytes (direct to R2, or the server-proxied fallback in local dev) →
 * complete (server verifies + thumbnails).
 *
 * `prepareImageForUpload` sits at this one funnel rather than at each composer
 * call site, the rule the native clients settled on in #84: it can't be
 * forgotten by a new caller, and the presign has to see the *final* size. */
export async function uploadFile(workspaceId: string, original: File): Promise<FileDTO> {
  const file = await prepareImageForUpload(original);
  const pres = await api<PresignedUploadDTO>('POST', `/v1/workspaces/${workspaceId}/files/presign`, {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  });
  const relative = pres.upload.url.startsWith('/'); // fallback URL needs our auth; R2 must NOT see it
  const put = await fetch(pres.upload.url, {
    method: pres.upload.method,
    headers: {
      ...pres.upload.headers,
      ...(relative ? { authorization: `Bearer ${getToken() ?? ''}` } : {}),
    },
    body: file,
  });
  if (!put.ok) throw new ApiError(put.status, 'upload_failed', `upload failed (HTTP ${put.status})`);
  return api<FileDTO>('POST', `/v1/files/${pres.file.id}/complete`);
}

/** POST one file as multipart — the server-buffered upload path avatars use.
 * Surfaces the server's own error text, so a rejected mime type or an
 * over-cap image says why rather than "upload failed". */
async function uploadMultipart<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${getToken() ?? ''}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { code: string; message: string } }).error;
    throw new ApiError(res.status, err?.code ?? 'upload_failed', err?.message ?? 'upload failed');
  }
  return json as T;
}

export function uploadAvatar(file: File): Promise<unknown> {
  return uploadMultipart('/v1/me/avatar', file);
}

/** Workspace avatar (#336) — owner/admin only; the response is the updated
 * workspace, and every other client hears about it on `workspace.updated`. */
export function uploadWorkspaceAvatar(workspaceId: string, file: File): Promise<WorkspaceDTO> {
  return uploadMultipart<WorkspaceDTO>(`/v1/workspaces/${workspaceId}/avatar`, file);
}

// Authenticated blobs (<img> can't send Authorization): fetch → object URL.
// File/thumb/avatar URLs are immutable per key, so cache forever.
const blobCache = new Map<string, Promise<string>>();

/** Resolved object URLs, mirrored out of `blobCache` as each promise settles.
 * Even an already-resolved promise only delivers on the next microtask, so a
 * component seeding its first render from `blobUrl(path)` always paints a
 * placeholder for one frame. `cachedBlobUrl` lets it seed synchronously from
 * a prior resolution instead. */
const resolvedBlobUrls = new Map<string, string>();

export function cachedBlobUrl(path: string): string | undefined {
  return resolvedBlobUrls.get(path);
}

/** Authenticated text fetch for inline file previews (same immutable-URL cache). */
const textCache = new Map<string, Promise<string>>();

export function fileText(path: string): Promise<string> {
  let cached = textCache.get(path);
  if (!cached) {
    cached = blobUrl(path).then((u) => fetch(u).then((r) => r.text()));
    cached.catch(() => textCache.delete(path));
    textCache.set(path, cached);
  }
  return cached;
}

export function blobUrl(path: string): Promise<string> {
  let cached = blobCache.get(path);
  if (!cached) {
    cached = (async () => {
      const res = await fetch(path, {
        headers: { authorization: `Bearer ${getToken() ?? ''}` },
      });
      if (!res.ok) throw new ApiError(res.status, 'blob_failed', `HTTP ${res.status}`);
      return URL.createObjectURL(await res.blob());
    })();
    void cached.then(
      (u) => resolvedBlobUrls.set(path, u),
      () => blobCache.delete(path),
    );
    blobCache.set(path, cached);
  }
  return cached;
}
