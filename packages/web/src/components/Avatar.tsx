// Initials-on-color avatar chips (design 3a) with real-image fallback, and the
// bearer-auth <img> helper shared by attachments and profile views.
import { useEffect, useState } from 'react';
import { blobUrl } from '../lib/api';
import { AgentMarkIcon } from './icons';

/* Design 3a avatar palette (bg / text), extended with two matching pairs. */
const PALETTE: [string, string][] = [
  ['#e9c8b0', '#7a4d2b'],
  ['#bcd0e9', '#2b527a'],
  ['#cbe3c9', '#3a6b3a'],
  ['#ffb547', '#5a3a00'],
  ['#e3c9e0', '#6b2b62'],
  ['#f0e0a8', '#6e5a14'],
];

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function chipColors(userId: string): [string, string] {
  return PALETTE[hash(userId) % PALETTE.length]!;
}

export function Avatar({
  userId,
  name,
  avatarUrl,
  size = 38,
  radius = 11,
  className = '',
  agent = false,
}: {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  size?: number;
  radius?: number;
  className?: string;
  /** AI teammate: teal identity chip + spark badge (signature, .impeccable.md). */
  agent?: boolean;
}) {
  const style = { width: size, height: size, borderRadius: radius };
  let core: React.ReactNode;
  if (avatarUrl) {
    core = <AuthImg path={avatarUrl} alt={name} className={`shrink-0 object-cover ${agent ? '' : className}`} style={style} />;
  } else if (agent) {
    // Agents don't get the human pastel palette — they wear the brand.
    core = (
      <span
        className={`flex shrink-0 items-center justify-center bg-accent font-extrabold text-white select-none ${agent ? '' : className}`}
        style={{ ...style, fontSize: Math.round(size * 0.37) }}
      >
        {initials(name)}
      </span>
    );
  } else {
    const [bg, fg] = chipColors(userId);
    core = (
      <span
        className={`flex shrink-0 items-center justify-center font-extrabold select-none ${className}`}
        style={{ ...style, background: bg, color: fg, fontSize: Math.round(size * 0.37) }}
      >
        {initials(name)}
      </span>
    );
  }
  if (!agent) return core;
  const badge = Math.max(12, Math.round(size * 0.42));
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}>
      {core}
      <span
        className="absolute flex items-center justify-center rounded-full bg-white text-accent shadow-card"
        style={{ width: badge, height: badge, right: -badge * 0.22, bottom: -badge * 0.18 }}
        title="AI agent"
      >
        <AgentMarkIcon size={Math.round(badge * 0.62)} />
      </span>
    </span>
  );
}

export function AuthImg({
  path,
  alt,
  className,
  style,
}: {
  path: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void blobUrl(path).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [path]);
  if (!url) return <span className={`inline-block animate-pulse rounded-lg bg-daypill ${className ?? ''}`} style={style} />;
  return <img src={url} alt={alt} className={className} style={style} />;
}
