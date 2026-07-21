// Preset agent avatars (AGENT_MEMBERS.md): a fixed set of robot faces the
// sponsor can pick during pairing approval. PNGs live in assets/agent-avatars
// (Flaticon free license, Freepik — see ATTRIBUTION.md there); the chosen one
// is pushed through the normal setAvatar pipeline (square-crop → webp → R2),
// so agents end up with ordinary `/v1/avatars/<key>` URLs like everyone else.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { badRequest, notFound } from '../lib/errors.js';

// src/services → packages/server (same shape compiled: dist/services → packages/server)
const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/agent-avatars');

const PRESET_ID_RE = /^robot-\d{2}$/;

/** Preset ids (robot-01 …), sorted — cached, the set is fixed at deploy time. */
let presetIds: string[] | null = null;
export function listAgentAvatarPresets(): string[] {
  if (!presetIds) {
    presetIds = fs
      .readdirSync(ASSETS_DIR)
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.slice(0, -'.png'.length))
      .filter((id) => PRESET_ID_RE.test(id))
      .sort();
  }
  return presetIds;
}

/** Raw PNG bytes of a preset (404 on unknown id; id format pre-checked). */
export function readAgentAvatarPreset(id: string): Buffer {
  if (!PRESET_ID_RE.test(id)) throw badRequest('bad_preset', 'unknown avatar preset');
  try {
    return fs.readFileSync(path.join(ASSETS_DIR, `${id}.png`));
  } catch {
    throw notFound('avatar preset not found');
  }
}
