-- Phase 3.5 ruling 3: workspace-wide sidebar branding (curated preset id).
ALTER TABLE workspaces ADD COLUMN sidebar_color text NOT NULL DEFAULT 'violet';
