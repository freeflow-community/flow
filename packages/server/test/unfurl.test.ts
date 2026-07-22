// Phase 11 unit tests: the pure layers of the unfurl pipeline — URL
// extraction/normalization (§1/§2), the SSRF address judgement (§4), robots
// parsing (§3), the metadata precedence chain (§5), and cache TTLs (§7).
//
// The network layers (fetcher, queue orchestration) are exercised through
// these seams rather than by hitting real hosts.
import { describe, expect, it } from 'vitest';
import {
  extractUrls,
  hostMatchesDomain,
  normalize,
  stripNonLinkRegions,
  urlHash,
} from '../src/services/unfurl/urls.js';
import { isBlockedAddress } from '../src/services/unfurl/ssrf.js';
import { isAllowedByRules, parseRobots } from '../src/services/unfurl/robots.js';
import {
  applyOembed,
  cardTypeForContentType,
  extractHtmlMetadata,
  hasRenderableContent,
  truncate,
} from '../src/services/unfurl/extract.js';
import { negativeTtlMs, positiveTtlMs, TTL_DEFAULT_MS, TTL_MAX_MS, TTL_MIN_MS } from '../src/services/unfurl/cache.js';
import { isAllowedByAllowlist, isDenied, UnfurlQueue } from '../src/services/unfurl/queue.js';
import { layoutFor, sniffImageFormat } from '../src/services/unfurl/images.js';

describe('§2 normalization', () => {
  it('lowercases scheme and host, strips default ports and fragments', () => {
    expect(normalize('HTTPS://Example.COM:443/A?b=1#frag')).toBe('https://example.com/A?b=1');
    expect(normalize('http://example.com:80/')).toBe('http://example.com/');
  });

  it('strips tracking params but preserves the order of the rest', () => {
    expect(normalize('https://e.com/p?b=2&utm_source=x&a=1&fbclid=y&c=3')).toBe(
      'https://e.com/p?b=2&a=1&c=3',
    );
  });

  it('punycodes IDN hosts so the cache key is stable', () => {
    expect(normalize('https://bücher.example/x')).toBe('https://xn--bcher-kva.example/x');
  });

  it('rejects non-http(s) schemes', () => {
    expect(normalize('ftp://example.com')).toBeNull();
    expect(normalize('javascript:alert(1)')).toBeNull();
    expect(normalize('file:///etc/passwd')).toBeNull();
    expect(normalize('not a url')).toBeNull();
  });

  it('hashes the normalized form, so equivalent URLs share a cache entry', () => {
    expect(urlHash(normalize('https://E.com/a?utm_source=q#x')!)).toBe(
      urlHash(normalize('https://e.com/a')!),
    );
  });
});

describe('§1 extraction', () => {
  it('blanks fenced code, inline code, and blockquotes', () => {
    const body = [
      'see https://keep.example/1',
      '```',
      'https://fenced.example/x',
      '```',
      '> https://quoted.example/x',
      'and `https://inline.example/x` too',
    ].join('\n');
    expect(extractUrls(body)).toEqual(['https://keep.example/1']);
    // blanking preserves length so offsets (and ordering) stay honest
    expect(stripNonLinkRegions(body).split('\n')[2]).toHaveLength('https://fenced.example/x'.length);
  });

  it('caps at 3 and keeps first-in-message order', () => {
    const body = 'a https://a.example b https://b.example c https://c.example d https://d.example';
    expect(extractUrls(body)).toEqual([
      'https://a.example/',
      'https://b.example/',
      'https://c.example/',
    ]);
  });

  it('deduplicates by normalized form', () => {
    expect(extractUrls('https://x.example/p?utm_source=a and https://X.example/p')).toEqual([
      'https://x.example/p',
    ]);
  });

  it('does not swallow trailing sentence punctuation', () => {
    expect(extractUrls('read https://x.example/a.')).toEqual(['https://x.example/a']);
    expect(extractUrls('(see https://x.example/b)')).toEqual(['https://x.example/b']);
  });

  it('finds nothing in a message with no links', () => {
    expect(extractUrls('just talking about example.com')).toEqual([]);
  });
});

describe('§4 SSRF address judgement', () => {
  it('blocks private, loopback, link-local and CGNAT v4', () => {
    for (const ip of ['10.0.0.1', '172.16.5.4', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('blocks loopback, ULA and link-local v6, including IPv4-mapped forms', () => {
    for (const ip of ['::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const ip of ['1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it('refuses anything that is not an IP literal', () => {
    expect(isBlockedAddress('example.com')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('§3 robots', () => {
  it('prefers our own agent group over the wildcard', () => {
    const txt = ['User-agent: *', 'Disallow: /', '', 'User-agent: flow-linkexpanding', 'Disallow: /private'].join('\n');
    const rules = parseRobots(txt);
    expect(isAllowedByRules(rules, '/public')).toBe(true);
    expect(isAllowedByRules(rules, '/private/x')).toBe(false);
  });

  it('falls back to the wildcard group', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /nope');
    expect(isAllowedByRules(rules, '/nope')).toBe(false);
    expect(isAllowedByRules(rules, '/yes')).toBe(true);
  });

  it('lets a longer Allow override a shorter Disallow', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b');
    expect(isAllowedByRules(rules, '/a/x')).toBe(false);
    expect(isAllowedByRules(rules, '/a/b/c')).toBe(true);
  });

  it('treats an empty Disallow as allow-all', () => {
    expect(isAllowedByRules(parseRobots('User-agent: *\nDisallow:'), '/anything')).toBe(true);
  });

  it('honours * and $ wildcards', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /*.pdf$');
    expect(isAllowedByRules(rules, '/docs/a.pdf')).toBe(false);
    expect(isAllowedByRules(rules, '/docs/a.pdf?x=1')).toBe(true);
  });

  it('ignores comments and blank lines', () => {
    expect(isAllowedByRules(parseRobots('# hi\n\nUser-agent: *\nDisallow: /x # trailing'), '/x')).toBe(false);
  });
});

describe('§5 extraction chain', () => {
  const page = `
    <html><head>
      <title>Bare title</title>
      <meta name="description" content="Bare description">
      <meta property="og:title" content="OG title">
      <meta property="og:site_name" content="Example">
      <meta property="og:image" content="/img/hero.png">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="630">
      <meta name="twitter:card" content="summary_large_image">
      <link rel="canonical" href="https://example.com/canonical">
    </head><body>ignored</body></html>`;

  it('prefers Open Graph over bare HTML, field by field', () => {
    const meta = extractHtmlMetadata(page, 'https://example.com/a/b');
    expect(meta.title).toBe('OG title'); // og wins
    expect(meta.description).toBe('Bare description'); // og absent → falls through
    expect(meta.siteName).toBe('Example');
  });

  it('resolves relative URLs against the final response URL', () => {
    const meta = extractHtmlMetadata(page, 'https://example.com/a/b');
    expect(meta.imageUrl).toBe('https://example.com/img/hero.png');
    expect(meta.canonicalUrl).toBe('https://example.com/canonical');
  });

  it('derives the large_image layout hint', () => {
    expect(extractHtmlMetadata(page, 'https://e.com/').layout).toBe('large_image');
    expect(extractHtmlMetadata('<html><head><title>t</title></head>', 'https://e.com/').layout).toBe(
      'thumbnail',
    );
  });

  it('decodes entities and strips tags from text fields', () => {
    const html = '<head><meta property="og:title" content="A &amp; B &lt;b&gt;bold&lt;/b&gt;"></head>';
    expect(extractHtmlMetadata(html, 'https://e.com/').title).toBe('A & B bold');
  });

  it('defaults the favicon to /favicon.ico', () => {
    expect(extractHtmlMetadata('<head><title>t</title></head>', 'https://e.com/x/y').faviconUrl).toBe(
      'https://e.com/favicon.ico',
    );
  });

  // Remote pages control these strings. example.com really ships
  // `<link rel="icon" href="data:,">`, and a hostile page can declare
  // `javascript:` just as easily — neither may reach a client.
  it('refuses non-http(s) URLs in URL-valued fields', () => {
    const hostile = `<head>
      <title>t</title>
      <link rel="icon" href="data:,">
      <link rel="canonical" href="javascript:alert(1)">
      <meta property="og:image" content="javascript:alert(2)">
    </head>`;
    const meta = extractHtmlMetadata(hostile, 'https://e.com/p');
    expect(meta.imageUrl).toBeUndefined();
    // canonical falls back to the final URL at the call site; here it's dropped
    expect(meta.canonicalUrl).toBeUndefined();
    // an unusable declared icon falls back to the conventional path
    expect(meta.faviconUrl).toBe('https://e.com/favicon.ico');
  });

  it('lets oEmbed outrank OG but only where it has values', () => {
    const base = extractHtmlMetadata(page, 'https://example.com/');
    const merged = applyOembed(base, { title: 'oEmbed title', provider_name: 'Provider' }, 'https://example.com/');
    expect(merged.title).toBe('oEmbed title');
    expect(merged.siteName).toBe('Provider');
    expect(merged.description).toBe('Bare description'); // untouched
  });

  it('truncates on a word boundary with an ellipsis', () => {
    expect(truncate('the quick brown fox jumps', 12)).toBe('the quick…');
    expect(truncate('short', 100)).toBe('short');
  });

  it('rejects a card with no title, description or image', () => {
    expect(hasRenderableContent({})).toBe(false);
    expect(hasRenderableContent({ title: 'x' })).toBe(true);
    expect(hasRenderableContent({ imageUrl: 'https://e.com/i.png' })).toBe(true);
  });

  it('dispatches on content type', () => {
    expect(cardTypeForContentType('text/html; charset=utf-8')).toBe('link');
    expect(cardTypeForContentType('image/png')).toBe('image');
    expect(cardTypeForContentType('video/mp4')).toBe('video');
    expect(cardTypeForContentType('application/pdf')).toBe('file');
    expect(cardTypeForContentType('application/zip')).toBeNull();
  });
});

describe('§7 cache TTLs', () => {
  it('clamps max-age into [1h, 7d]', () => {
    expect(positiveTtlMs('max-age=60')).toBe(TTL_MIN_MS); // below floor
    expect(positiveTtlMs('max-age=99999999')).toBe(TTL_MAX_MS); // above ceiling
    expect(positiveTtlMs('public, max-age=7200')).toBe(2 * 60 * 60 * 1000);
  });

  it('defaults to 24h with no usable header', () => {
    expect(positiveTtlMs(undefined)).toBe(TTL_DEFAULT_MS);
    expect(positiveTtlMs('public')).toBe(TTL_DEFAULT_MS);
  });

  it('still caches no-store, at the floor', () => {
    expect(positiveTtlMs('no-store')).toBe(TTL_MIN_MS);
  });

  it('uses the spec table for negative entries', () => {
    expect(negativeTtlMs('http_404')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(negativeTtlMs('ssrf')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(negativeTtlMs('robots')).toBe(24 * 60 * 60 * 1000);
    expect(negativeTtlMs('timeout')).toBe(15 * 60 * 1000);
    expect(negativeTtlMs('something-new')).toBe(15 * 60 * 1000); // conservative default
  });
});

describe('§10 domain gating', () => {
  it('matches a domain and its subdomains, on a label boundary', () => {
    expect(hostMatchesDomain('evil.com', 'evil.com')).toBe(true);
    expect(hostMatchesDomain('a.b.evil.com', 'evil.com')).toBe(true);
    expect(hostMatchesDomain('notevil.com', 'evil.com')).toBe(false);
  });

  it('denylists by domain', () => {
    expect(isDenied('tracker.evil.com', ['evil.com'])).toBe(true);
    expect(isDenied('good.com', ['evil.com'])).toBe(false);
  });

  it('treats an empty allowlist as allow-all', () => {
    expect(isAllowedByAllowlist('anything.com', null)).toBe(true);
    expect(isAllowedByAllowlist('anything.com', [])).toBe(true);
    expect(isAllowedByAllowlist('anything.com', ['ok.com'])).toBe(false);
    expect(isAllowedByAllowlist('sub.ok.com', ['ok.com'])).toBe(true);
  });
});

describe('§6 image proxy', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9)]);
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(6)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)]);
  const avif = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('avif'), Buffer.alloc(4)]);

  it('identifies formats by magic bytes, not content-type', () => {
    expect(sniffImageFormat(png)).toBe('png');
    expect(sniffImageFormat(jpeg)).toBe('jpeg');
    expect(sniffImageFormat(gif)).toBe('gif');
    expect(sniffImageFormat(webp)).toBe('webp');
    expect(sniffImageFormat(avif)).toBe('avif');
  });

  it('rejects SVG and other non-raster payloads (§6: script vector)', () => {
    expect(sniffImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniffImageFormat(Buffer.from('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(sniffImageFormat(Buffer.from('%PDF-1.7 not an image'))).toBeNull();
    expect(sniffImageFormat(Buffer.alloc(4))).toBeNull(); // too short
  });

  it('honours the spec layout rule for wide hero images', () => {
    expect(layoutFor(1200, 630, false)).toBe('large_image'); // aspect 1.9
    expect(layoutFor(1200, 200, false)).toBe('thumbnail'); // aspect 6 — a banner strip
    expect(layoutFor(300, 200, false)).toBe('thumbnail'); // too small either way
  });

  it('treats square and PORTRAIT media as large_image (deliberate §6 deviation)', () => {
    // Real dimensions from live pages. All three fall outside the spec's
    // 1.4-2.2 landscape band and would otherwise render as an 80px chip.
    expect(layoutFor(630, 630, false)).toBe('large_image'); // X, square
    expect(layoutFor(355, 630, false)).toBe('large_image'); // Instagram reel, 9:16
    expect(layoutFor(354, 630, false)).toBe('large_image'); // TikTok, 9:16
  });

  it('still keeps logos and slivers small', () => {
    expect(layoutFor(120, 120, false)).toBe('thumbnail'); // favicon-ish
    expect(layoutFor(400, 300, false)).toBe('thumbnail'); // long side under 600
    expect(layoutFor(800, 100, false)).toBe('thumbnail'); // short side a sliver
  });

  it('always honours an explicit summary_large_image', () => {
    expect(layoutFor(100, 100, true)).toBe('large_image');
  });
});

describe('§9 queue', () => {
  const immediate = async () => {};

  it('deduplicates by key', async () => {
    const q = new UnfurlQueue(immediate);
    let runs = 0;
    const job = { key: 'm:1', host: 'a.com', run: async () => { runs++; }, retryable: () => false };
    expect(q.enqueue(job)).toBe(true);
    expect(q.enqueue({ ...job })).toBe(false); // same key already queued/running
    await new Promise((r) => setTimeout(r, 10));
    expect(runs).toBe(1);
  });

  // §9 is internally inconsistent: it asks for "2 retries, backoff 5s / 30s"
  // AND a "total job budget 20s including retries". 5s + 30s = 35s, so the
  // second retry can never fit. The budget wins ("past that, mark failed"),
  // which means a transient failure gets the initial attempt plus ONE retry.
  it('retries a transient failure once, then hits the 20s job budget', async () => {
    const q = new UnfurlQueue(immediate);
    let attempts = 0;
    let failed: unknown = null;
    q.enqueue({
      key: 'm:2',
      host: 'a.com',
      run: async () => {
        attempts++;
        throw new Error('boom');
      },
      retryable: () => true,
      onError: (e) => { failed = e; },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(attempts).toBe(2); // initial + 1 retry; the 30s backoff exceeds the budget
    expect(failed).toBeInstanceOf(Error);
  });

  it('does not retry a non-retryable failure', async () => {
    const q = new UnfurlQueue(immediate);
    let attempts = 0;
    q.enqueue({
      key: 'm:3',
      host: 'a.com',
      run: async () => { attempts++; throw new Error('ssrf'); },
      retryable: () => false,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(attempts).toBe(1);
  });

  it('caps concurrency per host', async () => {
    const q = new UnfurlQueue(immediate);
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    for (let i = 0; i < 8; i++) {
      q.enqueue({
        key: `k${i}`,
        host: 'same.com',
        retryable: () => false,
        run: async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise<void>((r) => release.push(r));
          active--;
        },
      });
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(peak).toBeLessThanOrEqual(4); // §3 max concurrent per host
    release.forEach((r) => r());
  });

  it('stops dispatching once stopped', async () => {
    const q = new UnfurlQueue(immediate);
    q.stop();
    expect(q.enqueue({ key: 'x', host: 'a.com', run: async () => {}, retryable: () => false })).toBe(false);
  });
});
