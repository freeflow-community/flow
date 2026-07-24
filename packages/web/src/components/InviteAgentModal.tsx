// "Invite your Agent" call-to-action (phase 15): explains the one-command flow
// for bringing a coding agent into the workspace. It auto-closes the moment a
// pairing request naming this user as sponsor arrives — that's the agent
// self-registering, and AgentPairingPrompt takes over from here.
import { useEffect, useState } from 'react';
import { useAgentRequests } from '../hooks';
import { useAuth } from '../state';
import { Modal } from './modals';

const COMMAND = 'npx flow-agent-bridge';

export function InviteAgentModal({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const requests = useAgentRequests();
  const [copied, setCopied] = useState(false);

  // Auto-close when the agent self-registers: a live pairing request means the
  // approval prompt is about to appear, and the spec says this dialog steps aside.
  const hasLiveRequest = (requests.data ?? []).some((r) => Date.parse(r.expiresAt) > Date.now());
  useEffect(() => {
    if (hasLiveRequest) onClose();
  }, [hasLiveRequest, onClose]);

  const copy = () => {
    void navigator.clipboard?.writeText(COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Modal onClose={onClose} testid="invite-agent-modal" wide>
      <h3 className="mb-1 text-lg font-bold">Invite your Agent</h3>
      <p className="mb-4 text-sm text-ink-soft">
        Invite your coding agent (Claude, Codex, OpenCode, …) to join the workspace!
      </p>

      <p className="mb-1.5 text-sm text-ink-soft">Wherever you run your coding agent, just run:</p>
      <div className="mb-4 flex items-center gap-2">
        <code
          data-testid="invite-agent-command"
          className="flex-1 rounded-lg bg-daypill px-3 py-2 font-mono text-sm select-all"
        >
          {COMMAND}
        </code>
        <button
          data-testid="invite-agent-copy"
          className="shrink-0 rounded-lg border border-hairline2 px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-accent/10"
          onClick={copy}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p className="mb-3 text-sm text-ink-soft">
        Set your email — <span className="font-semibold text-ink">{auth.user.email}</span> — as the{' '}
        <span className="font-semibold text-ink">sponsor</span>. Your agent self-registers and you&rsquo;ll see a
        prompt like this to add it to the workspace:
      </p>

      <PairingPreview />

      <p className="mt-4 text-sm text-ink-soft">
        Collaborate with agents on tasks and code, share files and artifacts, and bring them onto the team.
      </p>

      <div className="mt-5 flex justify-end">
        <button
          data-testid="invite-agent-done"
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white"
          onClick={onClose}
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}

/** A static, non-interactive mock of AgentPairingPrompt so sponsors know what to
 * look for. Mirrors that component's layout without any live data or actions. */
function PairingPreview() {
  return (
    <div
      data-testid="invite-agent-preview"
      aria-hidden
      className="pointer-events-none select-none rounded-xl border border-hairline2 bg-base p-4 shadow-lg"
    >
      <p className="mb-1 text-sm font-bold">🤖 RepoBot is asking to join as your agent</p>
      <p className="mb-2 text-xs text-muted">
        Username <span className="font-mono">repobot</span>. You will be the sponsor, responsible for what it does.
        Only approve if the code below matches the one in the agent&rsquo;s terminal.
      </p>
      <div className="mb-3 flex justify-center">
        <code className="rounded-lg bg-daypill px-4 py-2 text-xl font-bold tracking-widest">7Q4K2</code>
      </div>
      <div className="flex justify-end gap-2">
        <span className="rounded px-3 py-1.5 text-sm font-semibold text-red-600">Deny</span>
        <span className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white">Approve</span>
      </div>
    </div>
  );
}
