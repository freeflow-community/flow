// Workspace sidebar palette (phase 3.5 ruling 3): workspace-wide branding,
// curated presets only — every gradient is tuned dark enough that the design-3a
// white sidebar text stays legible. Both clients render from these hex values;
// the server validates ids against SIDEBAR_COLOR_IDS.

export interface SidebarColor {
  id: string;
  name: string;
  /** gradient top (hex) */
  top: string;
  /** gradient bottom (hex) */
  bottom: string;
  /** workspace-rail shade (hex, slightly darker) */
  rail: string;
}

// "Deep water" retune (premium pass, .impeccable.md): every preset pulled
// deeper and less saturated so white sidebar text sits on ink, not candy.
// Ids are stable — existing workspaces keep their stored choice — with one
// addition ('teal', the new Flow default). macOS keeps its own Swift copy in
// SidebarPalette.swift; retunes ride the CHANGELOG Parity section until
// mirrored there.
export const SIDEBAR_COLORS: SidebarColor[] = [
  { id: 'teal', name: 'Teal', top: '#1F5A56', bottom: '#16443F', rail: '#123A38' }, // Flow default
  { id: 'violet', name: 'Violet', top: '#5D4A8A', bottom: '#473973', rail: '#3D3164' },
  { id: 'indigo', name: 'Indigo', top: '#3D4B96', bottom: '#2E3A7D', rail: '#27326C' },
  { id: 'ocean', name: 'Ocean', top: '#1D5F8C', bottom: '#154B72', rail: '#124163' },
  { id: 'forest', name: 'Forest', top: '#2E6B4F', bottom: '#22523D', rail: '#1C4634' },
  { id: 'ember', name: 'Ember', top: '#96512F', bottom: '#7C3F22', rail: '#6E381E' },
  { id: 'plum', name: 'Plum', top: '#7C3760', bottom: '#61294B', rail: '#552441' },
  { id: 'slate', name: 'Slate', top: '#46505F', bottom: '#353D4A', rail: '#2E3540' },
  { id: 'midnight', name: 'Midnight', top: '#232E52', bottom: '#1A2440', rail: '#161E37' },
];

export const SIDEBAR_COLOR_IDS = SIDEBAR_COLORS.map((c) => c.id);
export const DEFAULT_SIDEBAR_COLOR = 'teal';

export function sidebarColor(id: string | undefined | null): SidebarColor {
  return SIDEBAR_COLORS.find((c) => c.id === id) ?? SIDEBAR_COLORS[0]!;
}
