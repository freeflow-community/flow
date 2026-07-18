// REST client: same-origin (Vite proxy in dev, Fastify static in prod).
import type { FileDTO } from '@mychat/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'mychat.token';

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

export async function uploadFile(workspaceId: string, file: File): Promise<FileDTO> {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch(`/v1/workspaces/${workspaceId}/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${getToken() ?? ''}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { code: string; message: string } }).error;
    throw new ApiError(res.status, err?.code ?? 'upload_failed', err?.message ?? 'upload failed');
  }
  return json as FileDTO;
}

export async function uploadAvatar(file: File): Promise<unknown> {
  const form = new FormData();
  form.append('file', file, file.name);
  const res = await fetch('/v1/me/avatar', {
    method: 'POST',
    headers: { authorization: `Bearer ${getToken() ?? ''}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, 'avatar_failed', 'avatar upload failed');
  return json;
}

// Authenticated blobs (<img> can't send Authorization): fetch → object URL.
// File/thumb/avatar URLs are immutable per key, so cache forever.
const blobCache = new Map<string, Promise<string>>();

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
    cached.catch(() => blobCache.delete(path));
    blobCache.set(path, cached);
  }
  return cached;
}
