# URL unfurling

# URL Unfurl Service — Spec

## Scope

Server-side generation of link preview cards from public URLs. Non-authenticated only: no per-user or per-domain app hooks. Fetch, extract metadata, cache, attach to message.

---

## 1. Trigger

On message create/edit, extract candidate URLs from the message body.

**Extraction rules**
- Parse from the rendered AST, not raw text — skip URLs inside inline code, fenced code blocks, and blockquotes.
- Scheme must be `http` or `https`.
- Cap at **3 unfurls per message**, first-in-message order. Additional links are ignored (not queued).
- Deduplicate by normalized URL within the message.

**Channel-level suppression**
Skip if the same normalized URL was unfurled in the same channel within the last **6 hours**. Prevents repeat-link noise.

**Delivery**
Message send path never blocks. Enqueue an unfurl job keyed `(message_id, url_hash)`; the worker patches the message afterward and emits an update event to connected clients.

---

## 2. URL normalization

Applied before caching, dedup, and suppression checks.

- Lowercase scheme and host; strip default ports (`:80`, `:443`).
- Strip fragment (`#...`).
- Strip known tracking params: `utm_*`, `fbclid`, `gclid`, `mc_eid`, `ref`, `ref_src`, `igshid`.
- Preserve remaining query params in original order (do not sort — some sites are order-sensitive).
- Punycode-encode IDN hosts.
- Cache key: `sha256(normalized_url)`.

---

## 3. Fetch

**Request**
```
GET <url>
User-Agent: <ProductName>-LinkExpanding/1.0 (+https://<domain>/bot)
Accept: text/html,application/xhtml+xml,image/*,*/*;q=0.8
Accept-Encoding: gzip, br
Range: bytes=0-524287
```

**Limits**
| Constraint | Value |
|---|---|
| Connect timeout | 3s |
| Total timeout | 8s |
| Max redirects | 5 |
| Max body read | 512 KB (abort stream past limit) |
| Max concurrent per host | 4 |
| Per-host rate limit | 10 req/min |

**robots.txt**
Fetch and cache per-origin for 24h. Honor `Disallow` for the bot UA and `*`. On robots fetch failure, allow.

**Redirects**
Follow manually. Re-run the full SSRF check on every hop. Final URL after redirects is used for relative-URL resolution and `og:url` comparison; cache remains keyed on the original normalized URL, with a pointer record to the final URL's entry.

**Stop conditions**
Abort as soon as `</head>` is seen — full body is never needed for HTML.

---

## 4. SSRF guard

Runs before every connection, including each redirect hop.

- Resolve DNS explicitly; connect to the resolved IP with the hostname pinned in SNI/Host (prevents DNS rebinding between check and connect).
- Reject if any resolved address falls in: `10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `100.64/10`, `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped IPv6 equivalents.
- Reject non-`http(s)` schemes at every hop.
- Reject hosts resolving to the service's own egress or internal ranges via an explicit denylist.
- No proxy inheritance from environment.

---

## 5. Extraction

Content-type dispatch on the final response:

**`image/*`** → media card, `type: image`. Skip HTML parsing entirely.
**`video/*`, `audio/*`** → media card with direct source URL.
**`application/pdf`** → generic card: filename from URL or `Content-Disposition`, byte size, `type: file`.
**`text/html`, `application/xhtml+xml`** → parse `<head>`, run the precedence chain below.
**Anything else** → no unfurl.

### Precedence chain

Resolved field-by-field; a lower tier fills only what higher tiers left empty.

1. **oEmbed** — if `<link rel="alternate" type="application/json+oembed">` is present, fetch that endpoint (same fetch limits, same SSRF guard, JSON only, 32 KB cap). Use `title`, `author_name`, `provider_name`, `thumbnail_url`. If `type` is `video`/`rich`, record `html` but **do not render it** — store `provider` + `thumbnail` and link out. Rendering third-party HTML is out of scope for v1.
2. **Open Graph** — `og:title`, `og:description`, `og:image` (+ `og:image:width`/`height`/`alt`), `og:site_name`, `og:url`, `og:type`. For `og:type=article`, also `article:published_time`, `article:author`.
3. **Twitter Cards** — `twitter:title`, `twitter:description`, `twitter:image`, `twitter:site`. `twitter:card=summary_large_image` sets layout hint `large_image`.
4. **Bare HTML** — `<title>`, `<meta name="description">`, `<meta name="author">`, canonical link, favicon (`<link rel="icon">`, else `/favicon.ico`).

**Post-processing**
- Resolve relative URLs against the final response URL.
- Decode HTML entities; strip tags from text fields.
- Truncate: title 200 chars, description 400 chars, both on word boundary with ellipsis.
- Reject if title and description are both empty **and** there is no usable image → no unfurl (avoids empty cards).

---

## 6. Images

Never hotlink. Every image URL is rewritten to an internal proxy endpoint.

**Proxy pipeline**
- Fetch under the same SSRF guard and timeouts; 5 MB cap.
- Validate real content type by magic bytes, not header.
- Accept: JPEG, PNG, GIF, WebP, AVIF. Reject SVG (script vector).
- Reject dimensions above 12000px on either axis, or decoded-size estimate above 100 MP (decompression bomb guard).
- Strip all EXIF/XMP/ICC except color-space info needed for correct rendering.
- Re-encode to WebP at two sizes: thumbnail 128×128 (cover-cropped) and large 1200×630 max (contain, no upscale).
- Store in object storage keyed by content hash; serve from CDN.
- On any failure, drop the image field and render a text-only card. Never fail the whole unfurl.

**Layout hint**
`large_image` if `twitter:card=summary_large_image` or `og:image:width ≥ 600 && aspect ratio between 1.4 and 2.2`; else `thumbnail`.

---

## 7. Cache

**Positive**
Key `sha256(normalized_url)` → serialized `Unfurl` record. TTL from `Cache-Control: max-age` when present, clamped to **[1h, 7d]**; default **24h**.

**Negative**
Cache failures too, so a dead link isn't refetched on every mention.

| Outcome | TTL |
|---|---|
| 404, 410 | 7d |
| 401, 403 | 24h |
| robots disallowed | 24h |
| 5xx, timeout, connection error | 15m |
| SSRF rejected | 7d |
| Unsupported content type | 7d |

**Stale-while-revalidate**: serve an expired entry up to 24h past TTL while a refresh job runs in the background.

---

## 8. Output schema

```json
{
  "url": "https://example.com/article",
  "canonical_url": "https://example.com/article",
  "type": "link | image | video | audio | file",
  "layout": "thumbnail | large_image | media",
  "site_name": "Example",
  "favicon_url": "https://cdn.internal/f/<hash>",
  "title": "Article title",
  "description": "First 400 chars of description.",
  "author": "Jane Doe",
  "published_at": "2026-03-14T10:00:00Z",
  "image": {
    "url": "https://cdn.internal/i/<hash>/large",
    "thumb_url": "https://cdn.internal/i/<hash>/thumb",
    "width": 1200,
    "height": 630,
    "alt": "..."
  },
  "media": {
    "provider": "Example Video",
    "duration_sec": 212
  },
  "fetched_at": "2026-07-21T09:00:00Z",
  "expires_at": "2026-07-22T09:00:00Z"
}
```

All fields except `url` and `type` optional. Clients render whatever is present.

---

## 9. Worker & failure behavior

- Job queue with per-host concurrency limits so one slow domain can't starve the pool.
- Retry on transient failure (5xx, timeout): 2 retries, exponential backoff 5s / 30s. No retry on 4xx, robots, or SSRF rejection.
- Total job budget 20s including retries; past that, mark failed and cache negative.
- Failed unfurl is silent — the message renders with a plain link, no error surfaced to the user.

---

## 10. Controls

- **Per-message**: sender can delete an individual unfurl; deletion records a tombstone on `(message_id, url_hash)` so re-render doesn't resurrect it.
- **Per-user setting**: disable unfurling of links in own messages.
- **Per-workspace**: global on/off; optional domain allowlist mode for regulated deployments.
- **Domain denylist**: operator-maintained, checked pre-fetch, returns 7d negative cache.

---

## 11. Out of scope (v1)

- Authenticated / app-provided unfurls (`link_shared`-equivalent webhook model)
- Rendering third-party oEmbed HTML or embedded players
- Per-site custom scrapers
- Unfurl of internal workspace links (messages, files) — separate subsystem, no external fetch
