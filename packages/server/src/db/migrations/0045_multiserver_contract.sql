CREATE TABLE auth_handoffs (
  request_hash bytea PRIMARY KEY,
  connection_id text NOT NULL,
  operation_id text NOT NULL,
  state text NOT NULL,
  server_origin text NOT NULL,
  client_origin text,
  return_url text NOT NULL,
  code_challenge text NOT NULL,
  code_hash bytea UNIQUE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_handoffs_expiry_idx ON auth_handoffs (expires_at);
ALTER TABLE device_tokens ADD COLUMN routing_id text;
