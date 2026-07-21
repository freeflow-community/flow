// Artifact panel (phase 9): full-pane viewer for a bookmarked file. Renders
// images, video, text, PDF, and HTML (sandboxed iframe); anything else gets a
// download card. The underlying file stays access-checked server-side.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ArtifactDTO, FileDTO } from '@flow/shared';
import { api, blobUrl, fileStreamUrl, fileText } from '../lib/api';
import { bytesLabel } from '../lib/format';
import { isHtmlFile, isImageFile, isTextFile, isVideoFile } from '../lib/fileKind';
import { useSelection } from '../state';
import { useArtifacts } from '../hooks';

export default function ArtifactView({ artifactId }: { artifactId: string }) {
  const sel = useSelection();
  const qc = useQueryClient();
  const artifacts = useArtifacts(sel.workspaceId);
  const artifact = (artifacts.data ?? []).find((a) => a.id === artifactId);

  // The artifact vanished (removed on another device / event raced the list):
  // fall back to the channel behind it.
  useEffect(() => {
    if (artifacts.data && !artifact) sel.selectArtifact(null);
  }, [artifacts.data, artifact, sel]);

  if (!artifact) {
    return <div className="flex min-w-0 flex-1 items-center justify-center text-faint">Loading…</div>;
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-testid={`artifact-view-${artifact.name}`}>
      <ArtifactHeader
        artifact={artifact}
        onClose={() => sel.selectArtifact(null)}
        onRenamed={() => void qc.invalidateQueries({ queryKey: ['artifacts', artifact.workspaceId] })}
      />
      <ArtifactContent key={artifact.fileId} file={artifact.file} />
    </div>
  );
}

function ArtifactHeader({
  artifact,
  onClose,
  onRenamed,
}: {
  artifact: ArtifactDTO;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(artifact.name);
  const save = async () => {
    const next = name.trim();
    setEditing(false);
    if (next && next !== artifact.name) {
      await api('PATCH', `/v1/artifacts/${artifact.id}`, { name: next });
      onRenamed();
    } else {
      setName(artifact.name);
    }
  };
  const download = async () => {
    const url = await blobUrl(`/v1/files/${artifact.file.id}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = artifact.file.name;
    a.click();
  };
  return (
    <div className="flex h-[60px] shrink-0 items-center gap-2 border-b border-hairline px-[22px]">
      {editing ? (
        <input
          className="min-w-0 flex-1 rounded border border-hairline2 bg-white px-2 py-1 text-[15px] font-bold"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') { setEditing(false); setName(artifact.name); }
          }}
          onBlur={() => void save()}
          autoFocus
        />
      ) : (
        <button
          data-testid="artifact-title"
          className="min-w-0 flex-1 truncate text-left text-[15px] font-bold hover:underline"
          title="Rename"
          onClick={() => setEditing(true)}
        >
          {artifact.name}
        </button>
      )}
      <span className="shrink-0 text-xs text-faint">{bytesLabel(artifact.file.sizeBytes)}</span>
      <button
        data-testid="artifact-download"
        className="flex h-7 w-7 items-center justify-center rounded-lg text-sm text-faint hover:bg-daypill hover:text-ink"
        title="Download"
        onClick={() => void download()}
      >
        ⤓
      </button>
      <button
        data-testid="artifact-close"
        className="flex h-7 w-7 items-center justify-center rounded-lg text-sm text-faint hover:bg-daypill hover:text-ink"
        title="Close"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}

function ArtifactContent({ file }: { file: FileDTO }) {
  if (isImageFile(file)) return <ImagePane file={file} />;
  if (isVideoFile(file)) return <VideoPane file={file} />;
  if (file.mimeType === 'application/pdf') return <PdfPane file={file} />;
  if (isHtmlFile(file)) return <HtmlPane file={file} />;
  if (isTextFile(file)) return <TextPane file={file} />;
  return <DownloadPane file={file} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center text-faint">{children}</div>;
}

function ImagePane({ file }: { file: FileDTO }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void blobUrl(`/v1/files/${file.id}`).then((u) => { if (alive) setUrl(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file.id]);
  if (failed) return <DownloadPane file={file} />;
  if (!url) return <Centered>Loading…</Centered>;
  return (
    <div className="mc-scroll flex min-h-0 flex-1 items-center justify-center overflow-auto bg-daypill/40 p-4">
      <img src={url} alt={file.name} className="max-h-full max-w-full rounded-lg" data-testid={`artifact-image-${file.name}`} />
    </div>
  );
}

/** Streamed when the server can presign (R2 serves Range); whole-blob fallback
 * otherwise — mirrors the chat card's strategy. */
function VideoPane({ file }: { file: FileDTO }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void fileStreamUrl(file.id)
      .then((r) => {
        if (!alive) return null;
        if (r.url) { setUrl(r.url); return null; }
        return blobUrl(`/v1/files/${file.id}`).then((u) => { if (alive) setUrl(u); });
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file.id]);
  if (failed) return <DownloadPane file={file} />;
  if (!url) return <Centered>Loading…</Centered>;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-black/90 p-4">
      <video
        data-testid={`artifact-video-${file.name}`}
        src={url}
        controls
        className="max-h-full max-w-full rounded-lg"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function PdfPane({ file }: { file: FileDTO }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void blobUrl(`/v1/files/${file.id}`).then((u) => { if (alive) setUrl(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file.id]);
  if (failed) return <DownloadPane file={file} />;
  if (!url) return <Centered>Loading…</Centered>;
  return (
    <embed
      data-testid={`artifact-pdf-${file.name}`}
      src={url}
      type="application/pdf"
      className="min-h-0 flex-1"
    />
  );
}

/** Sandboxed HTML render: scripts may run, but no same-origin access — the
 * document can never reach our token/localStorage or call the API as the user. */
function HtmlPane({ file }: { file: FileDTO }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void fileText(`/v1/files/${file.id}`).then((t) => { if (alive) setHtml(t); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file.id]);
  if (failed) return <DownloadPane file={file} />;
  if (html === null) return <Centered>Loading…</Centered>;
  return (
    <iframe
      data-testid={`artifact-html-${file.name}`}
      title={file.name}
      srcDoc={html}
      sandbox="allow-scripts"
      className="min-h-0 flex-1 bg-white"
    />
  );
}

const TEXT_MAX = 1_000_000; // chars — full-pane viewer, roomier than the chat preview

function TextPane({ file }: { file: FileDTO }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void fileText(`/v1/files/${file.id}`).then((t) => { if (alive) setText(t); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [file.id]);
  if (failed) return <DownloadPane file={file} />;
  if (text === null) return <Centered>Loading…</Centered>;
  return (
    <div className="mc-scroll min-h-0 flex-1 overflow-auto">
      <pre
        data-testid={`artifact-text-${file.name}`}
        className="px-[22px] py-4 font-mono text-xs leading-5 whitespace-pre text-ink"
      >
        {text.slice(0, TEXT_MAX)}
      </pre>
      {text.length > TEXT_MAX && (
        <p className="px-[22px] pb-4 text-xs text-faint">Showing the first 1 MB — download for the full file.</p>
      )}
    </div>
  );
}

function DownloadPane({ file }: { file: FileDTO }) {
  const download = async () => {
    const url = await blobUrl(`/v1/files/${file.id}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  };
  return (
    <Centered>
      <button
        data-testid={`artifact-chip-${file.name}`}
        className="flex items-center gap-2 rounded-[10px] border border-hairline bg-white px-4 py-3 text-left text-sm hover:border-hairline2"
        onClick={() => void download()}
      >
        <span>📄</span>
        <span>
          <span className="block font-medium">{file.name}</span>
          <span className="block text-xs text-muted">{bytesLabel(file.sizeBytes)} — click to download</span>
        </span>
      </button>
    </Centered>
  );
}
