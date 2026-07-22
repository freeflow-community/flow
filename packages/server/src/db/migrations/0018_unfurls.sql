-- Phase 11: URL unfurling (docs/specs/phase11.md).
--
-- Three tables and three settings. The cache is keyed by sha256 of the
-- NORMALIZED url (§2) and holds negative entries too (§7), so a dead link is
-- not refetched on every mention. message_unfurls attaches cache entries to
-- messages and carries the per-unfurl tombstone from §10.

-- §7 cache. `ok=false` rows are negative entries; `data` is only set when ok.
CREATE TABLE unfurl_cache (
  url_hash text PRIMARY KEY,              -- sha256(normalized_url), hex
  normalized_url text NOT NULL,
  ok boolean NOT NULL,
  failure_reason text,                    -- 'http_404' | 'robots' | 'ssrf' | 'timeout' | …
  data jsonb,                             -- UnfurlDTO when ok
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
-- stale-while-revalidate sweeps and cache eviction both scan by expiry
CREATE INDEX unfurl_cache_expires_idx ON unfurl_cache (expires_at);

-- Which unfurls belong to which message, in first-in-message order (§1).
-- channel_id is denormalized so the 6h per-channel suppression check (§1) is a
-- single index hit rather than a join back to messages.
CREATE TABLE message_unfurls (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  url_hash text NOT NULL,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  position smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- §10 tombstone: the sender deleted this one; re-render must not resurrect it
  deleted_at timestamptz,
  PRIMARY KEY (message_id, url_hash)
);
CREATE INDEX message_unfurls_suppression_idx
  ON message_unfurls (channel_id, url_hash, created_at DESC);

-- §10 operator-maintained denylist. A row blocks the exact host and any
-- subdomain of it; checked pre-fetch and cached negative for 7d.
CREATE TABLE unfurl_domain_denylist (
  domain text PRIMARY KEY,                -- lowercase, no scheme, no port
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- §10 controls.
-- Per-user: don't unfurl links in my own messages.
ALTER TABLE users ADD COLUMN unfurl_own_links boolean NOT NULL DEFAULT true;
-- Per-workspace: global switch, plus optional allowlist mode for regulated
-- deployments (NULL = allow all; non-null = only these domains unfurl).
ALTER TABLE workspaces ADD COLUMN unfurl_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE workspaces ADD COLUMN unfurl_domain_allowlist text[];
