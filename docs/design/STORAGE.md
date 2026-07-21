# STORAGE.md — file storage design (Cloudflare R2 + presigned direct transfer)

How Flow stores and serves file attachments, thumbnails, and avatars.
Shipped 2026-07-20/21 (operator rulings in `decision_log.md`; ops runbook and
env vars in `docs/ops/DEPLOYMENT.md`). Audience: anyone touching file handling on the
server or a client, and integrators wondering what a file URL actually is.

## The seam

All blob I/O goes through the `BlobStore` interface
(`packages/server/src/storage/index.ts`):

```
put/get/delete/head          — byte-level operations
presignPut(key, {contentType, contentLength}) → {url, method, headers} | null
presignGet(key, {filename?, contentType?, inline?}) → url | null
```

Two drivers, selected by `FLOW_BLOB_DRIVER`:

| | `local` (default) | `r2` |
|---|---|---|
| Bytes live in | `FLOW_FILE_DIR` on disk | Cloudflare R2 bucket (`FLOW_R2_BUCKET`, S3 API) |
| `presignPut`/`presignGet` | return `null` → server proxies | real presigned URLs (PUT 15 min, GET 5 min TTL) |
| Used by | local dev, tests | production (makes the app service stateless) |

Clients are driver-unaware: the API shape is identical, only the URLs the
server hands back differ. That's the whole trick — read the upload flow next.

## Upload: presign → PUT → complete

Uploading is a three-step handshake so the bytes can go straight to R2
without ever passing through the app server:

1. **`POST /v1/workspaces/:id/files/presign`** with
   `{filename, mimeType, sizeBytes}`. The server checks membership and the
   size cap, inserts a `files` row with `status='pending'`, and returns
   `{file: FileDTO, upload: {url, method: 'PUT', headers}}`.
   - On R2 the URL is presigned with **content-length and content-type as
     signed headers** — the uploader must send *exactly* the declared size
     and type or R2 rejects the PUT with 403. This is how the size cap
     survives the server never seeing the bytes.
   - **Two caps** (2026-07-21 ruling): the presign path allows 500 MB
     (`FLOW_MAX_FILE_MB` to tune) because the bytes stream to R2; the
     server-buffered paths — legacy multipart, Slack-compat `files.upload`,
     avatars — keep 20 MB (`maxServerUploadBytes`) because they hold whole
     files in app-server memory.
   - On the local driver `presignPut` returns `null`, so the server
     substitutes its own fallback target: `PUT /v1/files/:id/content`
     (server-relative URL, needs the bearer token; enforces the same
     exact-size contract). Same client code path either way — clients just
     look at whether the URL starts with `/` to know if auth is needed.
2. **Client PUTs the bytes** to `upload.url` with `upload.headers`.
   Absolute (R2) URLs must NOT carry the bearer token — S3-style endpoints
   reject requests with both a signed query string and an Authorization
   header.
3. **`POST /v1/files/:id/complete`**. The server HEADs the object (exists?
   size matches the declaration?), and for images ≤ 32 MB
   (`thumbSourceMaxBytes` — the sidecar step pulls the object into memory)
   GETs the bytes to extract dimensions and generate a max-512px webp
   thumbnail (`thumbs/<id>`), then flips the row to `status='ready'`.
   Idempotent — a retry after success returns the DTO again.

`pending` files are invisible everywhere: not downloadable, not attachable
to messages (`validateAttachments` filters on `ready`), never hydrated into
DTOs. If a client dies mid-upload, the daily orphan sweep (files never
attached within 24 h — decision log ruling 5) reaps the row and any bytes.

The **legacy multipart endpoint** (`POST /v1/workspaces/:id/files`, single
`file` field) still works — used by the Slack-compat `files.upload` and any
un-upgraded client. It inserts directly as `ready`.

## Download: access check, then 302

`GET /v1/files/:id` (and `/thumb`) always runs the permission check first
(uploader, or workspace member with channel access to a message the file is
attached to). Then:

- **R2 driver, plaintext blob**: respond `302` to a 5-minute presigned R2
  URL (`response-content-disposition` carries the filename; thumbs are
  `inline`). R2 serves Range requests natively, so video seeking works
  against the redirect target.
- **Local driver, or legacy encrypted rows**: the server proxies the bytes
  itself (with its own Range handling), exactly as before R2.

The short TTL is the security model: URLs are minted per-request *after*
the access check, so a leaked URL is stale in minutes and there are no
long-lived public links. (If shareable links are ever wanted, that's a new
feature — don't just lengthen the TTL.)

### Streaming URLs (media playback)

`GET /v1/files/:id/url` returns JSON `{url, expiresInSeconds}` — a
**1-hour** presigned GET (inline disposition) meant to be handed directly to
a media element or player, so a feature-length video can play and seek
without re-minting. `url` is `null` on the local driver or for legacy
encrypted rows; callers fall back to fetching bytes through the proxy
route. The web video card uses this (streams + seeks via R2 Range; re-mints
once on error in case the TTL expired in a long-open tab). Native clients
don't use it yet — they stream the download to disk and play the local file
(Parity gap; the fix is AVPlayer pointed at this URL).

### Client redirect rules

The 302 hop crosses origins (API host → `*.r2.cloudflarestorage.com`), and
R2 rejects dual auth, so the bearer token must not follow the redirect:

- **Web**: nothing to do — the fetch spec strips `Authorization` on
  cross-origin redirects, and every evergreen browser implements it. The web
  client still fetches via `blobUrl()` (object URLs) because `<img>` can't
  send auth headers; the `blob:` URLs users see are in-memory handles, not
  server addresses.
- **macOS/iOS**: CFNetwork's redirect header handling is inconsistent across
  OS versions, so `APIClient` installs a `RedirectSanitizer`
  (`URLSessionTaskDelegate`) that explicitly drops `Authorization` whenever
  a redirect leaves the API host. Both platforms share this file verbatim.

### CORS (bites every new bucket)

Browsers preflight the presigned PUT and CORS-check the redirected GET, so
**a bucket without a CORS policy breaks web upload AND image loading while
native clients work perfectly** — curl and URLSession never preflight, which
is exactly how this shipped broken on first prod smoke. The policy (allowed
origins = web origins; `GET, PUT, HEAD`; headers `content-type, range`) is
part of one-time bucket setup — exact recipe in `docs/ops/DEPLOYMENT.md`. R2 CORS
changes take ~1 min to propagate; the S3 endpoint's TLS itself only
provisions ~1 min after the account's first bucket exists.

## Encryption posture

R2-era blobs are stored **plaintext** (operator ruling, 2026-07-20): the
server never sees direct-upload bytes, so app-layer AES-GCM can't exist on
this path. Protection = R2 at-rest encryption + access-checked, short-lived
URLs. In the `files` table, `enc_key_id IS NULL` marks a plaintext blob.

- **Legacy rows** (`enc_key_id` set) are AES-256-GCM envelopes from the
  pre-R2 era; they still decrypt through the crypto keyring and are always
  server-proxied (R2 can't serve them directly). The one-time migration
  (`FLOW_MIGRATE_BLOBS=1` at boot, `tools/migrateBlobsToR2.ts`) decrypted
  and copied everything to R2 and nulled `enc_key_id` — prod ran clean
  2026-07-21 (23 files + 2 avatars, 0 missing), so legacy rows should no
  longer exist in prod; the code path stays as a safety net.
- **Message bodies are unaffected** — they were and remain AES-256-GCM
  encrypted in Postgres. The ruling covers file/thumb/avatar blobs only.

## Key layout & sidecars

```
files/<fileId>    original bytes (any type)
thumbs/<fileId>   max-512px webp, images only, generated at complete-time
avatars/<key>     512px square webp, unencrypted since phase 2, key rotates per upload
```

Keys are always server-generated — never derived from user input. Avatars
don't use the files table or the presign flow; they upload through the small
multipart `POST /v1/me/avatar` and are served proxied (immutable-cached).

## Migration history

- `0013_r2_blobs.sql`: `enc_key_id` nullable (NULL = plaintext) + `status`
  column (`pending`/`ready`) for the presign lifecycle.
- The `/data` Railway volume is rollback-only after the verified prod
  migration; droppable.
