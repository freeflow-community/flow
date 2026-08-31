-- Phase 18 M3: Socket Mode connection tickets move to the database so a
-- ticket minted by one replica (apps.connections.open) redeems on whichever
-- replica the WebSocket lands on. Single-use via DELETE ... RETURNING; only
-- the sha256 of the ticket is stored, like every other token.
CREATE TABLE app_socket_tickets (
  token_hash bytea PRIMARY KEY,
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
