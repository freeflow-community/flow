// #220: the profile website is a link every client renders, so the schema —
// the single write path for PATCH /v1/me — is what keeps a `javascript:` or
// `data:` URL out of the database in the first place. These tests are the
// evidence that the allowlist is enforced server-side and not by a client.
import { describe, expect, it } from 'vitest';
import {
  PatchMeBody,
  PROFILE_BIO_MAX,
  PROFILE_TITLE_MAX,
  PROFILE_WEBSITE_MAX,
  isProfileWebsiteUrl,
} from '@flow/shared';

const ok = (body: unknown) => PatchMeBody.safeParse(body).success;

describe('profile website validation', () => {
  it('accepts absolute http and https URLs', () => {
    expect(ok({ website: 'https://example.com' })).toBe(true);
    expect(ok({ website: 'http://example.com/~me/page?q=1#frag' })).toBe(true);
    expect(ok({ website: 'HTTPS://EXAMPLE.COM' })).toBe(true);
  });

  it("accepts '' to clear the link", () => {
    expect(ok({ website: '' })).toBe(true);
  });

  it('rejects script-bearing schemes — the stored-XSS case', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(ok({ website: bad }), bad).toBe(false);
    }
  });

  it('rejects a scheme smuggled in behind whitespace or control characters', () => {
    // a browser strips these before parsing an href; the schema must not
    expect(ok({ website: '  javascript:alert(1)' })).toBe(false);
    expect(ok({ website: '\njavascript:alert(1)' })).toBe(false);
    expect(ok({ website: 'java\tscript:alert(1)' })).toBe(false);
    expect(ok({ website: 'https://example.com javascript:alert(1)' })).toBe(false);
  });

  it('rejects relative paths, bare hostnames and a scheme with no host', () => {
    expect(ok({ website: 'example.com' })).toBe(false);
    expect(ok({ website: '/about' })).toBe(false);
    expect(ok({ website: '//example.com' })).toBe(false);
    expect(ok({ website: 'https://' })).toBe(false);
  });

  it(`rejects a website longer than ${PROFILE_WEBSITE_MAX} characters`, () => {
    const long = `https://example.com/${'a'.repeat(PROFILE_WEBSITE_MAX)}`;
    expect(ok({ website: long })).toBe(false);
    expect(ok({ website: `https://e.co/${'a'.repeat(PROFILE_WEBSITE_MAX - 14)}` })).toBe(true);
  });

  it('reports a message a person can act on', () => {
    const r = PatchMeBody.safeParse({ website: 'ftp://example.com' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('http://');
  });

  it('isProfileWebsiteUrl agrees with the schema', () => {
    expect(isProfileWebsiteUrl('https://example.com')).toBe(true);
    expect(isProfileWebsiteUrl('javascript:alert(1)')).toBe(false);
    expect(isProfileWebsiteUrl('')).toBe(false); // '' is "no link", not a URL
  });
});

describe('profile bio validation', () => {
  it('accepts plain text with newlines, and accepts clearing it', () => {
    expect(ok({ bio: 'Line one.\nLine two.\n\nLine four.' })).toBe(true);
    expect(ok({ bio: '' })).toBe(true);
  });

  it('stores markup literally rather than rejecting it (the bio is plain text)', () => {
    const r = PatchMeBody.safeParse({ bio: '<script>alert(1)</script> **not bold**' });
    expect(r.success).toBe(true);
    // unchanged on the way through — every client renders it escaped
    if (r.success) expect(r.data.bio).toBe('<script>alert(1)</script> **not bold**');
  });

  it(`rejects a bio longer than ${PROFILE_BIO_MAX} characters`, () => {
    expect(ok({ bio: 'a'.repeat(PROFILE_BIO_MAX) })).toBe(true);
    expect(ok({ bio: 'a'.repeat(PROFILE_BIO_MAX + 1) })).toBe(false);
  });
});

describe('profile title validation (#434)', () => {
  it("accepts a one-line title, and '' to clear it", () => {
    expect(ok({ title: 'Founder, Biztrip AI' })).toBe(true);
    expect(ok({ title: '' })).toBe(true);
  });

  it('trims before storing, so padding never becomes part of the title', () => {
    const r = PatchMeBody.safeParse({ title: '  Founder, Biztrip AI  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.title).toBe('Founder, Biztrip AI');
  });

  it('trims a whitespace-only title down to "unset" rather than storing blanks', () => {
    const r = PatchMeBody.safeParse({ title: '   ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.title).toBe('');
  });

  it(`rejects a title longer than ${PROFILE_TITLE_MAX} characters`, () => {
    expect(ok({ title: 'a'.repeat(PROFILE_TITLE_MAX) })).toBe(true);
    expect(ok({ title: 'a'.repeat(PROFILE_TITLE_MAX + 1) })).toBe(false);
  });

  it('measures the length after trimming — padding cannot push a title over', () => {
    expect(ok({ title: `  ${'a'.repeat(PROFILE_TITLE_MAX)}  ` })).toBe(true);
  });
});

describe('PatchMeBody still requires something to update', () => {
  it('rejects an empty patch', () => {
    expect(ok({})).toBe(false);
  });

  it('counts website, bio or title alone as something to update', () => {
    expect(ok({ website: 'https://example.com' })).toBe(true);
    expect(ok({ bio: 'hello' })).toBe(true);
    expect(ok({ title: 'Founder' })).toBe(true);
  });
});
