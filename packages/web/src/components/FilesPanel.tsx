// Channel Files panel (#347): every file shared in a channel, as one vertical
// list in the existing side panel — the same surface threads and artifacts
// use, so chat stays visible next to it.
//
// Deliberately plain: text links for the sort instead of a dropdown, no grid,
// no filter chips. The panel is a finding tool, and a file is found by
// scanning names and dates, so the row leads with a thumbnail and says name,
// size, uploader and date, and that is all.
import { useEffect, useRef, useState } from 'react';
import type { ChannelFileDTO, ChannelFileSort } from '@flow/shared';
import { blobUrl, fileStreamUrl } from '../lib/api';
import { bytesLabel } from '../lib/format';
import { isImageFile, isVideoFile } from '../lib/fileKind';
import { useChannelFiles, useChannels } from '../hooks';
import { useSelection } from '../state';
import { LightboxButton, LightboxShell } from './Lightbox';
import { useFileImageSource } from './FileImage';

const SORTS: { key: ChannelFileSort; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
];

/** Type-block for the non-previewable rows: the extension on a tinted square,
 * the way the mockup shows PDF / ZIP / XLS. */
const TYPE_TINTS: Record<string, string> = {
  pdf: 'bg-rose-100 text-rose-600',
  zip: 'bg-violet-100 text-violet-600',
  gz: 'bg-violet-100 text-violet-600',
  tar: 'bg-violet-100 text-violet-600',
  xls: 'bg-emerald-100 text-emerald-700',
  xlsx: 'bg-emerald-100 text-emerald-700',
  csv: 'bg-emerald-100 text-emerald-700',
  doc: 'bg-sky-100 text-sky-700',
  docx: 'bg-sky-100 text-sky-700',
  key: 'bg-amber-100 text-amber-700',
  ppt: 'bg-amber-100 text-amber-700',
  pptx: 'bg-amber-100 text-amber-700',
};

function extOf(name: string): string {
  const e = name.split('.').pop()?.toLowerCase() ?? '';
  return e && e.length <= 4 && e !== name.toLowerCase() ? e : 'file';
}

/** "Aug 24", or "Aug 24, 2025" once the year stops being obvious. */
function dateLabel(iso: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date().getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString([], opts);
}

export function durationLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function itemsLabel(total: number): string {
  return `${total} ${total === 1 ? 'item' : 'items'}`;
}

export default function FilesPanel({ channelId }: { channelId: string }) {
  const sel = useSelection();
  const channels = useChannels(sel.workspaceId);
  const [sort, setSort] = useState<ChannelFileSort>('newest');
  const [preview, setPreview] = useState<ChannelFileDTO | null>(null);
  const files = useChannelFiles(channelId, sort);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const channel = (channels.data ?? []).find((c) => c.id === channelId);
  const pages = files.data?.pages ?? [];
  const rows = pages.flatMap((p) => p.files);
  const total = pages[0]?.total ?? 0;

  // Infinite scroll: one sentinel below the last row, the same shape the
  // message list uses. Re-observed on every page so the ref stays live.
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = files;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(node);
    return () => io.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, rows.length]);

  return (
    <>
      <FilesList
        channelName={channel?.name ?? null}
        total={total}
        sort={sort}
        onSort={setSort}
        rows={rows}
        loading={files.isLoading}
        loadingMore={isFetchingNextPage}
        sentinelRef={sentinel}
        onOpen={setPreview}
      />
      {preview && <FilePreview file={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

/** The panel body itself — header, sort links, rows. Split out from the data
 * wiring above so it renders (and is asserted on) without a query client. */
export function FilesList({
  channelName,
  total,
  sort,
  onSort,
  rows,
  loading,
  loadingMore,
  sentinelRef,
  onOpen,
}: {
  channelName: string | null;
  total: number;
  sort: ChannelFileSort;
  onSort: (s: ChannelFileSort) => void;
  rows: ChannelFileDTO[];
  loading: boolean;
  loadingMore: boolean;
  sentinelRef?: React.Ref<HTMLDivElement>;
  onOpen: (f: ChannelFileDTO) => void;
}) {
  return (
    <div data-testid="files-panel" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3.5 pt-3">
        <p className="text-[15px] font-bold text-ink">
          Files{' '}
          <span data-testid="files-panel-subtitle" className="text-[12.5px] font-normal text-muted">
            · {channelName ? `#${channelName}` : 'channel'} · {itemsLabel(total)}
          </span>
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <span>Sort:</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              data-testid={`files-sort-${s.key}`}
              aria-current={sort === s.key}
              className={
                sort === s.key
                  ? 'font-bold text-accent underline underline-offset-2'
                  : 'text-muted hover:text-ink hover:underline hover:underline-offset-2'
              }
              onClick={() => onSort(s.key)}
            >
              {s.label}
            </button>
          ))}
        </p>
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {loading ? (
          <p className="px-1.5 py-6 text-center text-[13px] text-faint">Loading…</p>
        ) : rows.length === 0 ? (
          <p data-testid="files-empty" className="px-1.5 py-10 text-center text-[13px] text-faint">
            No files shared yet
          </p>
        ) : (
          rows.map((f) => (
            <FileRow key={`${f.messageId}-${f.id}`} file={f} onOpen={() => onOpen(f)} />
          ))
        )}
        <div ref={sentinelRef} />
        {loadingMore && <p className="py-2 text-center text-[12px] text-faint">Loading more…</p>}
      </div>
    </div>
  );
}

/** Fetch + download the original bytes under its real filename. */
function useDownload(file: ChannelFileDTO): () => Promise<void> {
  return async () => {
    const url = await blobUrl(`/v1/files/${file.id}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  };
}

function FileRow({ file, onOpen }: { file: ChannelFileDTO; onOpen: () => void }) {
  const download = useDownload(file);
  return (
    <div className="group flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 hover:bg-accent/[0.06]">
      <button
        type="button"
        data-testid={`files-row-${file.name}`}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        onClick={onOpen}
      >
        <RowThumb file={file} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-ink">{file.name}</span>
          <span className="block truncate text-[12px] text-muted">
            {bytesLabel(file.sizeBytes)} · {file.uploaderName} · {dateLabel(file.createdAt)}
          </span>
        </span>
      </button>
      <button
        type="button"
        data-testid={`files-download-${file.name}`}
        title={`Download ${file.name}`}
        aria-label={`Download ${file.name}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[13px] text-accent hover:bg-accent/20"
        onClick={() => void download()}
      >
        ⤓
      </button>
    </div>
  );
}

/** Image thumbnail, video first-frame (+ duration badge), or a type block. */
function RowThumb({ file }: { file: ChannelFileDTO }) {
  const [src, setSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const image = isImageFile(file) && file.hasThumb;
  const video = isVideoFile(file);
  const imageSource = useFileImageSource(file.id, 'thumbnail', image);

  useEffect(() => {
    let alive = true;
    if (video) {
      // Metadata only — a presigned URL lets the browser read the header (and
      // paint frame one) without pulling a whole video into the panel. When
      // the server can't presign (local dev, legacy rows) we stay on the type
      // block rather than downloading megabytes for a 56px square.
      void fileStreamUrl(file.id).then((r) => { if (alive && r.url) setSrc(r.url); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [file.id, video]);

  const box = 'h-[38px] w-14 shrink-0 overflow-hidden rounded-[7px]';
  if (image) {
    return imageSource.src && imageSource.status !== 'failed' ? (
      <img
        src={imageSource.src}
        alt=""
        className={`${box} bg-daypill object-cover`}
        onLoad={imageSource.onLoad}
        onError={imageSource.onError}
      />
    ) : (
      <span
        role={imageSource.status === 'failed' ? 'img' : 'status'}
        aria-label={imageSource.status === 'failed' ? 'Preview unavailable' : 'Loading preview'}
        className={`${box} flex items-center justify-center bg-daypill text-xs text-faint`}
      >
        {imageSource.status === 'failed' ? '!' : ''}
      </span>
    );
  }
  if (video) {
    return (
      <span className={`${box} relative block bg-slate-800`}>
        {src && (
          <video
            src={src}
            preload="metadata"
            muted
            className="h-full w-full object-cover"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d)) setDuration(d);
            }}
          />
        )}
        <span className="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 text-[9px] leading-[13px] font-semibold text-white">
          {duration === null ? '▶' : durationLabel(duration)}
        </span>
      </span>
    );
  }
  const ext = extOf(file.name);
  return (
    <span
      className={`${box} flex items-center justify-center text-[10px] font-bold tracking-wide uppercase ${
        TYPE_TINTS[ext] ?? 'bg-daypill text-muted'
      }`}
    >
      {ext}
    </span>
  );
}

/**
 * Preview over the chat. Images and videos get the lightbox chrome the message
 * list already uses; a PDF gets the browser's own viewer in the same shell;
 * anything else has no in-app renderer, so opening it downloads it.
 */
function FilePreview({ file, onClose }: { file: ChannelFileDTO; onClose: () => void }) {
  const download = useDownload(file);
  const [url, setUrl] = useState<string | null>(null);
  const image = isImageFile(file);
  const video = isVideoFile(file);
  const pdf = file.mimeType === 'application/pdf';
  const inline = image || video || pdf;
  const imageSource = useFileImageSource(file.id, 'original', image);

  useEffect(() => {
    let alive = true;
    if (!inline) {
      void download().finally(() => { if (alive) onClose(); });
      return () => { alive = false; };
    }
    if (image) return () => { alive = false; };
    // Video prefers the presigned stream URL (seekable, no full download);
    // PDF and the local-dev fallback read the bytes.
    const load = video
      ? fileStreamUrl(file.id).then((r) => r.url ?? blobUrl(`/v1/files/${file.id}`))
      : blobUrl(`/v1/files/${file.id}`);
    void load.then((u) => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, image, inline, video]);

  if (!inline) return null;

  return (
    <LightboxShell
      testId="files-preview"
      onClose={onClose}
      caption={`${file.name} · ${bytesLabel(file.sizeBytes)} · ${file.uploaderName} · ${dateLabel(file.createdAt)}`}
      actions={
        <LightboxButton testId="files-preview-download" title="Download" onClick={() => void download()}>
          ⤓ Download
        </LightboxButton>
      }
    >
      {image ? (
        imageSource.src && imageSource.status !== 'failed' ? (
          <img
            src={imageSource.src}
            alt={file.name}
            className="max-h-[85vh] max-w-[88vw] rounded-lg object-contain"
            onLoad={imageSource.onLoad}
            onError={imageSource.onError}
          />
        ) : imageSource.status === 'failed' ? (
          <div role="alert" className="flex flex-col items-center gap-2 text-sm text-white/70">
            <span>Preview unavailable</span>
            <button
              type="button"
              className="rounded-md border border-white/30 px-3 py-1.5 font-semibold text-white hover:bg-white/10"
              onClick={imageSource.retry}
            >
              Retry
            </button>
          </div>
        ) : (
          <span className="text-sm text-white/70">Loading…</span>
        )
      ) : !url ? (
        <span className="text-sm text-white/70">Loading…</span>
      ) : video ? (
        <video src={url} controls autoPlay className="max-h-[85vh] max-w-[88vw] rounded-lg bg-black" />
      ) : (
        <embed src={url} type="application/pdf" className="h-[85vh] w-[80vw] rounded-lg" />
      )}
    </LightboxShell>
  );
}
