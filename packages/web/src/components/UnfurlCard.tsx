import { useQueryClient } from '@tanstack/react-query';
import type { ArtifactDTO, UnfurlDTO } from '@flow/shared';
import { api } from '../lib/api';
import { useSelection } from '../state';
import { AuthImg } from './Avatar';
import { CloseIcon, PinIcon } from './icons';

/**
 * Phase 11 link preview card. Renders whatever fields the server sent — every
 * field except `url`/`type` is optional, so each block is independently
 * conditional and a sparse card (title only) still looks deliberate.
 *
 * The server rejects non-http(s) URLs during extraction, so these are safe to
 * put in an href; `rel="noopener noreferrer"` is belt-and-braces.
 */
export function UnfurlCard({
  unfurl,
  messageId,
  channelId,
  workspaceId,
  canRemove,
}: {
  unfurl: UnfurlDTO;
  messageId: string;
  channelId: string;
  workspaceId: string | null;
  canRemove: boolean;
}) {
  const qc = useQueryClient();
  const sel = useSelection();
  const target = unfurl.canonicalUrl ?? unfurl.url;
  const host = hostOf(target);

  // Pin this link as a co-browsing artifact in the channel and open it.
  const pin = async () => {
    const a = await api<ArtifactDTO>('POST', '/v1/artifacts', { channelId, url: target });
    await qc.invalidateQueries({ queryKey: ['artifacts', workspaceId] });
    sel.selectArtifact(a.id);
  };

  const remove = async () => {
    await api('DELETE', `/v1/messages/${messageId}/unfurls/${unfurl.urlHash}`);
    // The server republishes the message, but invalidate so the removal is
    // immediate even if the socket is down.
    await qc.invalidateQueries({ queryKey: ['messages'] });
    await qc.invalidateQueries({ queryKey: ['thread'] });
  };

  return (
    <div
      data-testid="unfurl-card"
      data-url={unfurl.url}
      className="group/unfurl relative mt-1.5 flex max-w-[520px] gap-2.5 rounded-lg border border-hairline bg-white/60 py-2 pr-2 pl-3"
    >
      {/* Slack-style accent rail */}
      <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent/35" />

      <div className="min-w-0 flex-1">
        {(unfurl.siteName || host) && (
          <div className="flex items-center gap-1.5 text-xs text-muted">
            {unfurl.faviconUrl && (
              // Proxied like the main image — the server never hands us a
              // third-party favicon URL, so this is an auth'd internal path.
              <AuthImg path={unfurl.faviconUrl} alt="" className="h-3.5 w-3.5 rounded-sm object-contain" />
            )}
            <span className="truncate">{unfurl.siteName ?? host}</span>
          </div>
        )}

        {unfurl.title && (
          <a
            data-testid="unfurl-title"
            href={target}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block truncate text-sm font-semibold text-accent-soft hover:underline"
          >
            {unfurl.title}
          </a>
        )}

        {unfurl.description && (
          <p className="mt-0.5 line-clamp-3 text-sm text-ink-soft">{unfurl.description}</p>
        )}

        {(unfurl.author || unfurl.publishedAt) && (
          <p className="mt-1 text-xs text-faint">
            {[unfurl.author, formatDate(unfurl.publishedAt)].filter(Boolean).join(' · ')}
          </p>
        )}

        {unfurl.image && (
          // The image links out to the shared page, like the title — clicking
          // the picture is the obvious gesture, and matches Slack.
          //
          // Preview images are served from our own auth'd endpoint (§6 — we
          // never hotlink), so they load through AuthImg like attachments and
          // avatars rather than a bare <img src>, which can't send the header.
          <a
            data-testid="unfurl-image-link"
            href={target}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block w-fit"
          >
            <AuthImg
              path={unfurl.layout === 'large_image' ? unfurl.image.url : (unfurl.image.thumbUrl ?? unfurl.image.url)}
              alt={unfurl.image.alt ?? ''}
              // `contain`, not `cover`: social previews are often portrait or
              // square, and cropping them to a wide box cuts the subject out.
              className={`rounded-md border border-hairline object-contain hover:brightness-95 ${
                unfurl.layout === 'large_image' ? 'max-h-[320px] max-w-full' : 'max-h-[80px] w-auto'
              }`}
            />
          </a>
        )}
      </div>

      <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover/unfurl:opacity-100">
        <button
          data-testid="unfurl-pin"
          title="Pin as artifact"
          aria-label="Pin as artifact"
          className="flex h-5 shrink-0 items-center rounded px-1 text-faint hover:bg-daypill hover:text-ink"
          onClick={() => void pin()}
        >
          <PinIcon size={13} />
        </button>
        {canRemove && (
          <button
            data-testid="unfurl-remove"
            title="Remove this preview"
            aria-label="Remove this preview"
            className="flex h-5 shrink-0 items-center rounded px-1 text-faint hover:bg-daypill hover:text-ink"
            onClick={() => void remove()}
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
