// Content types for the bundled web client. The Vite build emits a short,
// fixed set of extensions; anything else is served as bytes.
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

export function contentTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : '';
  return TYPES[ext] ?? 'application/octet-stream';
}

/** A request path that names a file (has an extension) is served as that
 * file; a bare route (`/`, `/invite/abc`) is the single-page app. */
export function isAssetPath(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  return last.includes('.');
}
