-- Phase 18 M1: fixed-window rate-limit counters shared across replicas.
-- Only the per-user limiter keys use this (delete-me, join-redeem); the
-- unauthenticated per-IP limits stay in-process (documented divergence,
-- docs/design/DISTRIBUTED_PRESENCE.md §2).
CREATE TABLE rate_limit_windows (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 1
);
