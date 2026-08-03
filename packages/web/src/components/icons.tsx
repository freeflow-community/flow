// Flow icon system (premium pass): one 16-grid stroke set, drawn for optical
// balance at 14–18px. currentColor throughout so icons inherit text color;
// size via the `size` prop. Emoji is reserved for *content* (reactions, user
// statuses) — never for UI glyphs.
import type { SVGProps } from 'react';
import type { FileDTO } from '@flow/shared';
import { isHtmlFile, isImageFile, isTextFile, isVideoFile } from '../lib/fileKind';

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function base(p: IconProps) {
  const { size = 16, ...rest } = p;
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  };
}

export function CloseIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 8.5l3.2 3.2L13 5" />
    </svg>
  );
}

/** Send: arrow rising out of a shallow tray — motion, not a paper plane. */
export function SendIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 12V3.5" />
      <path d="M4.5 7L8 3.5 11.5 7" />
    </svg>
  );
}

export function SmileIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.6 9.4a3.1 3.1 0 0 0 4.8 0" />
      <path d="M6.1 6.3h.01M9.9 6.3h.01" strokeWidth="1.8" />
    </svg>
  );
}

/** Add-reaction: smile with a tiny + riding the top-right shoulder. */
export function AddReactionIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M14.2 8.6A6.25 6.25 0 1 1 7.4 1.8" />
      <path d="M5.6 9.4a3.1 3.1 0 0 0 4.8 0" />
      <path d="M6.1 6.3h.01M9.9 6.3h.01" strokeWidth="1.8" />
      <path d="M12.5 1.5v4M10.5 3.5h4" />
    </svg>
  );
}

export function ThreadIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5 5.5 5.5 0 0 1 13.5 8Z" />
      <path d="M8 13.5c0 .9.4 1.6 1 2l-3-1.2" />
    </svg>
  );
}

export function CopyIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.25A1.75 1.75 0 0 0 8.75 1.5h-4.5A1.75 1.75 0 0 0 2.5 3.25v4.5c0 .97.78 1.75 1.75 1.75h.25" />
    </svg>
  );
}

export function EditIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M9.8 3.2l3 3L6 13H3v-3l6.8-6.8Z" />
      <path d="M8.6 4.4l3 3" />
    </svg>
  );
}

export function TrashIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2.75 4.25h10.5" />
      <path d="M6.5 2.5h3" />
      <path d="M4 4.25l.6 8.1c.06.9.81 1.65 1.72 1.65h3.36c.9 0 1.66-.72 1.72-1.65l.6-8.1" />
      <path d="M6.6 7v4M9.4 7v4" />
    </svg>
  );
}

export function PinIcon({ filled = false, ...p }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(p)} fill={filled ? 'currentColor' : 'none'}>
      <path d="M9.3 1.9l4.8 4.8-1.9.5-2 2-.3 3.3-2.3-2.3L4 13.8 2.2 12l3.6-3.6L3.5 6.1l3.3-.3 2-2 .5-1.9Z" />
    </svg>
  );
}

export function BellIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 2a4 4 0 0 1 4 4c0 2.6.7 4 1.4 4.8H2.6C3.3 10 4 8.6 4 6a4 4 0 0 1 4-4Z" />
      <path d="M6.6 13.3a1.5 1.5 0 0 0 2.8 0" />
    </svg>
  );
}

export function BellOffIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 3.2A4 4 0 0 1 12 6c0 1.9.4 3.2 .9 4M3.7 6.7C3.6 8.9 3 10.2 2.6 10.8h8.2" />
      <path d="M6.6 13.3a1.5 1.5 0 0 0 2.8 0" />
      <path d="M2.5 2l11 11" />
    </svg>
  );
}

export function ShieldIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 1.8l5 1.8v4c0 3.2-2.1 5.6-5 6.6-2.9-1-5-3.4-5-6.6v-4l5-1.8Z" />
    </svg>
  );
}

export function UsersIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.8 13.2c.5-2.2 2.2-3.4 4.2-3.4s3.7 1.2 4.2 3.4" />
      <path d="M10.8 3.4a2.5 2.5 0 0 1 0 4.2M12.4 10.1c1 .6 1.6 1.7 1.9 3.1" />
    </svg>
  );
}

export function LockIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

export function HashIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6.6 2.5L5 13.5M11 2.5L9.4 13.5M3 6h10.4M2.6 10H13" />
    </svg>
  );
}

export function DownloadIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 2.5v7.5M4.8 7l3.2 3 3.2-3" />
      <path d="M3 13.5h10" />
    </svg>
  );
}

export function ExternalIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12V9.5" />
      <path d="M9.5 2.5h4v4M13.2 2.8L8 8" />
    </svg>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

export function ChevronUpIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 10l4-4 4 4" />
    </svg>
  );
}

export function MenuIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </svg>
  );
}

export function DocIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 1.8h5.2L13 5.6V13a1.2 1.2 0 0 1-1.2 1.2H4A1.2 1.2 0 0 1 2.8 13V3A1.2 1.2 0 0 1 4 1.8Z" />
      <path d="M9 2v4h4" />
    </svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function ArrowDownIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 3v10M3.8 8.8L8 13l4.2-4.2" />
    </svg>
  );
}

export function LinkIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M6.6 9.4l2.8-2.8" />
      <path d="M7.5 4.6l1.6-1.6a2.75 2.75 0 0 1 3.9 3.9l-1.6 1.6M8.5 11.4l-1.6 1.6a2.75 2.75 0 0 1-3.9-3.9l1.6-1.6" />
    </svg>
  );
}

export function ImageIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="2" y="2.8" width="12" height="10.4" rx="1.5" />
      <circle cx="5.6" cy="6.2" r="1.1" />
      <path d="M2.5 11.5l3.2-3 2.5 2.3 2.7-2.8 2.6 2.8" />
    </svg>
  );
}

export function FilmIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M5 3v10M11 3v10M2 6h3M2 10h3M11 6h3M11 10h3" />
    </svg>
  );
}

export function GlobeIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M1.8 8h12.4M8 1.8c1.7 1.7 2.5 3.8 2.5 6.2S9.7 12.5 8 14.2c-1.7-1.7-2.5-3.8-2.5-6.2S6.3 3.5 8 1.8Z" />
    </svg>
  );
}

/** Sidebar/panel glyph for an artifact by file kind (replaces emoji fileGlyph). */
export function FileKindIcon({ file, ...p }: IconProps & { file: FileDTO | null }) {
  if (!file) return <LinkIcon {...p} />;
  if (isImageFile(file)) return <ImageIcon {...p} />;
  if (isVideoFile(file)) return <FilmIcon {...p} />;
  if (isHtmlFile(file)) return <GlobeIcon {...p} />;
  if (isTextFile(file) || file.mimeType === 'application/pdf') return <DocIcon {...p} />;
  return <DocIcon {...p} />;
}

export function StopIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The agent mark (signature identity, .impeccable.md): a four-point spark —
 * agents are the "something more" in the room. Filled, not stroked, so it
 * reads at 10px next to a display name.
 */
export function AgentMarkIcon(p: IconProps) {
  const { size = 12, ...rest } = p;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden {...rest}>
      <path
        fill="currentColor"
        d="M8 1.2c.6 3.4 1.6 4.7 5.6 5.9v1.8c-4 1.2-5 2.5-5.6 5.9h-.1C7.3 11.4 6.3 10.1 2.3 8.9V7.1c4-1.2 5-2.5 5.6-5.9H8Z"
      />
    </svg>
  );
}
