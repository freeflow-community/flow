// Custom emoji management (#175). Owner/admin, web client — same shape as
// Manage Apps/Agents. Uploading reuses the ordinary presigned file upload, then
// registers the resulting file id under a shortcode.
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CUSTOM_EMOJI_CODE_RE, type WorkspaceEmojiDTO } from '@flow/shared';
import { api, uploadFile } from '../lib/api';
import { useWorkspaceEmoji } from '../hooks';
import { CustomEmojiImage } from './CustomEmoji';
import { Modal } from './modals';

const MAX_EMOJI_BYTES = 256 * 1024; // mirrors the server's limit

export function EmojiModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const emoji = useWorkspaceEmoji(workspaceId);
  const [shortcode, setShortcode] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const code = shortcode.trim().toLowerCase();
  const codeOk = CUSTOM_EMOJI_CODE_RE.test(code);
  const taken = (emoji.data ?? []).some((e) => e.shortcode === code);
  const canAdd = codeOk && !taken && file !== null && !busy;

  const pickFile = (f: File | null) => {
    setError(null);
    if (f && f.size > MAX_EMOJI_BYTES) {
      setError(`Images must be under ${MAX_EMOJI_BYTES / 1024}KB — that one is ${Math.round(f.size / 1024)}KB.`);
      setFile(null);
      return;
    }
    setFile(f);
    // Default the shortcode to the filename, so the common case is one click.
    if (f && !shortcode.trim()) {
      const base = f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
      if (CUSTOM_EMOJI_CODE_RE.test(base)) setShortcode(base);
    }
  };

  const add = async () => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const uploaded = await uploadFile(workspaceId, file);
      await api<WorkspaceEmojiDTO>('POST', `/v1/workspaces/${workspaceId}/emoji`, {
        shortcode: code,
        fileId: uploaded.id,
      });
      setShortcode('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await qc.invalidateQueries({ queryKey: ['emoji', workspaceId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: WorkspaceEmojiDTO) => {
    setError(null);
    try {
      await api('DELETE', `/v1/workspaces/${workspaceId}/emoji/${e.id}`);
      await qc.invalidateQueries({ queryKey: ['emoji', workspaceId] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  };

  const list = emoji.data ?? [];

  return (
    <Modal onClose={onClose} testid="emoji-modal">
      <h3 className="mb-1 font-bold">Custom emoji</h3>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Upload an image and give it a name. Anyone in the workspace can then react with it.
          PNG, GIF, WebP or JPEG, under {MAX_EMOJI_BYTES / 1024}KB.
        </p>

        <div className="flex flex-col gap-2 rounded-lg border border-hairline p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">:</span>
            <input
              data-testid="emoji-shortcode"
              className="min-w-0 flex-1 rounded border border-hairline2 px-2 py-1 text-sm"
              placeholder="party-parrot"
              value={shortcode}
              onChange={(ev) => setShortcode(ev.target.value)}
            />
            <span className="text-sm text-muted">:</span>
          </div>
          <input
            ref={fileInput}
            data-testid="emoji-file"
            type="file"
            accept="image/png,image/gif,image/webp,image/jpeg"
            className="text-sm"
            onChange={(ev) => pickFile(ev.target.files?.[0] ?? null)}
          />
          {shortcode.trim() && !codeOk && (
            <p className="text-xs text-faint">
              Letters, digits, <code>-</code> and <code>_</code> only; 2–32 characters.
            </p>
          )}
          {taken && <p className="text-xs text-faint">:{code}: already exists.</p>}
          <button
            data-testid="emoji-add"
            className="self-start rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
            disabled={!canAdd}
            onClick={() => void add()}
          >
            {busy ? 'Uploading…' : 'Add emoji'}
          </button>
        </div>

        {error && (
          <p data-testid="emoji-error" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold text-faint uppercase">
            {list.length} {list.length === 1 ? 'emoji' : 'emoji'}
          </p>
          {list.length === 0 ? (
            <p data-testid="emoji-empty" className="text-sm text-muted">
              No custom emoji yet.
            </p>
          ) : (
            <ul className="mc-scroll max-h-64 divide-y divide-hairline overflow-y-auto rounded-lg border border-hairline">
              {list.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                  <CustomEmojiImage emoji={e} size={24} />
                  <code className="min-w-0 flex-1 truncate text-sm">{e.emoji}</code>
                  <button
                    data-testid={`emoji-delete-${e.shortcode}`}
                    className="text-sm text-muted hover:text-red-600 hover:underline"
                    onClick={() => void remove(e)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
