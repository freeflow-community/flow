-- Link artifacts: artifacts gain a second kind — a pinned link (URL) alongside the
-- existing pinned file. A link artifact opens in a shared "mini-browser" whose
-- URL is co-browsed: any member changing the URL re-points the artifact (via
-- artifact.updated) and everyone's viewer follows. Because a link has no
-- backing file, file_id becomes nullable and a kind discriminator plus a CHECK
-- keeps each row well-formed (file rows carry file_id, link rows carry url).
ALTER TABLE artifacts ALTER COLUMN file_id DROP NOT NULL;
ALTER TABLE artifacts ADD COLUMN kind text NOT NULL DEFAULT 'file';
ALTER TABLE artifacts ADD COLUMN url  text;
ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_kind_shape CHECK (
    (kind = 'file' AND file_id IS NOT NULL AND url IS NULL) OR
    (kind = 'link' AND url IS NOT NULL AND file_id IS NULL)
  );
-- Link pins are idempotent per channel, mirroring the file-pin index. A link
-- artifact's url is mutable (co-browsing), so this only prevents two identical
-- pins existing at creation time — same spirit as owns_file=false file pins.
CREATE UNIQUE INDEX artifacts_channel_link_pin ON artifacts (channel_id, url) WHERE kind = 'link';
