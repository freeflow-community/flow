-- Images pasted into a community email (#492).
--
-- A broadcast's <img src> is fetched by a mail client with no Flow session, so
-- it cannot point at /v1/files/:id — that route checks membership and would
-- render as a broken image in every inbox. This table is the capability: a
-- random token that grants read access to exactly one uploaded image, served
-- by the unauthenticated GET /v1/email-images/:token.
--
-- It is a *join* onto `files` rather than a second upload pipeline: the paste
-- goes through the same presign -> PUT -> complete flow as any attachment, and
-- adoption afterwards is what turns a private upload into a public one. That
-- also gives the orphan sweep something to see — a file referenced here is
-- never attached to a message, and would otherwise be reaped 24h later,
-- breaking the images in every email already sent.
--
-- Rows are permanent on purpose. A mail sent last year is still in someone's
-- inbox, and an expiring image URL is a broken image with extra steps.
CREATE TABLE workspace_email_images (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The whole of the access check for GET /v1/email-images/:token. 128 bits of
  -- randomness, base64url, so the link stays short enough to read in a
  -- markdown source line.
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The sweeper's NOT EXISTS probe, and the "already adopted?" lookup that keeps
-- a re-adopted file on its original URL.
CREATE INDEX workspace_email_images_file_idx ON workspace_email_images (file_id);
