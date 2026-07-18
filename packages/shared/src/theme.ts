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

export const SIDEBAR_COLORS: SidebarColor[] = [
  { id: 'violet', name: 'Violet', top: '#7D3AB7', bottom: '#5A2FB0', rail: '#5528A9' }, // design 3a default
  { id: 'indigo', name: 'Indigo', top: '#4A50C0', bottom: '#343BA8', rail: '#2E339B' },
  { id: 'ocean', name: 'Ocean', top: '#1E6FA8', bottom: '#155A8C', rail: '#124E7B' },
  { id: 'forest', name: 'Forest', top: '#2F7D5A', bottom: '#20634A', rail: '#1B5740' },
  { id: 'ember', name: 'Ember', top: '#B0532B', bottom: '#93401F', rail: '#83381A' },
  { id: 'plum', name: 'Plum', top: '#8C2F66', bottom: '#6F2350', rail: '#612046' },
  { id: 'slate', name: 'Slate', top: '#4A5568', bottom: '#374151', rail: '#303845' },
  { id: 'midnight', name: 'Midnight', top: '#23305E', bottom: '#1A2547', rail: '#16203E' },
];

export const SIDEBAR_COLOR_IDS = SIDEBAR_COLORS.map((c) => c.id);
export const DEFAULT_SIDEBAR_COLOR = 'violet';

export function sidebarColor(id: string | undefined | null): SidebarColor {
  return SIDEBAR_COLORS.find((c) => c.id === id) ?? SIDEBAR_COLORS[0]!;
}
