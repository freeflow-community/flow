-- Huddles in DMs (#436). A huddle in a channel stays ambient and leaves no
-- trace; a huddle in a 1:1 or group DM *rings*, and a ring that nobody
-- answered has to be visible afterwards — so DM huddles get rows and channel
-- huddles deliberately do not.
--
-- Two tables, because a group-DM ring is one call with several independent
-- answers: `huddle_invites` is the call (who started it, when it ended, the
-- transcript line it produced), `huddle_invite_targets` is one row per person
-- rung (accepted / declined / missed). A 1:1 call is just the degenerate case
-- with a single target row.
--
-- These rows survive a restart, which is the point: the in-memory roster in
-- huddles.ts is a cache of LiveKit, but "you missed a call" is a fact about
-- the past that no live system holds. A `ringing` row found at boot is one
-- whose 30s timer died with the old process — services/huddleInvites.ts
-- sweeps those to `missed` on startup.
CREATE TABLE huddle_invites (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  started_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- ringing -> active -> ended, or declined / missed / cancelled.
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  -- first accept (group DMs can have several; this is the one that made the
  -- call real). NULL on a call nobody answered.
  answered_at timestamptz,
  ended_at timestamptz,
  -- Denormalized answered_at -> ended_at seconds, so rendering "Call ended ·
  -- 4 min" never has to reason about two nullable timestamps.
  duration_seconds integer,
  -- The transcript line this call posted into the DM. ON DELETE SET NULL: a
  -- purged message must not take the call record with it.
  system_message_id uuid REFERENCES messages(id) ON DELETE SET NULL
);

-- The DM's call history, newest first.
CREATE INDEX huddle_invites_channel_idx ON huddle_invites (channel_id, started_at DESC);
-- Boot sweep + the "is this callee already being rung?" check.
CREATE INDEX huddle_invites_ringing_idx ON huddle_invites (status) WHERE status IN ('ringing', 'active');

CREATE TABLE huddle_invite_targets (
  invite_id uuid NOT NULL REFERENCES huddle_invites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- ringing -> accepted / declined / missed. `unavailable` is the instant
  -- miss: no live socket, DND, muted DM, or already in another DM huddle —
  -- recorded distinctly from a 30s timeout because the caller was told
  -- immediately ("X isn't available") and the two mean different things.
  status text NOT NULL,
  responded_at timestamptz,
  PRIMARY KEY (invite_id, user_id)
);

CREATE INDEX huddle_invite_targets_user_idx ON huddle_invite_targets (user_id);
