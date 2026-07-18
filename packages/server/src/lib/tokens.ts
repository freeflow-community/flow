import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Random 32-byte token, base64url-encoded (returned to the client once). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 of the raw token — the only thing we store. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function tokensEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
