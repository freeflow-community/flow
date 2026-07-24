// "Invite your Agent" call-to-action (phase 15): generates a one-time invite
// code for this workspace and shows the exact command to run. The agent redeems
// the code and joins immediately — no sponsor approval, no matching popup. The
// code carries the sponsor (you) + workspace; a fresh code is minted each time
// the dialog opens, and each code is single-use.
import { useEffect, useState } from 'react';
import { useCreateAgentInvite } from '../hooks';
import { Modal } from './modals';

export function InviteAgentModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const createInvite = useCreateAgentInvite(workspaceId);
  const [copied, setCopied] = useState(false);

  // Mint a code as soon as the dialog opens. `mutate` is stable across renders,
  // so this runs exactly once per open.
  const { mutate } = createInvite;
  useEffect(() => {
    mutate();
  }, [mutate]);

  const command = createInvite.data?.command ?? '';
  const copy = () => {
    if (!command) return;
    void navigator.clipboard?.writeText(command).then(() => {
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
      <div className="mb-2 flex items-center gap-2">
        <code
          data-testid="invite-agent-command"
          className="min-h-[2.5rem] flex-1 rounded-lg bg-daypill px-3 py-2 font-mono text-sm break-all select-all"
        >
          {createInvite.isPending && 'Generating your invite code…'}
          {createInvite.isError && 'Could not generate an invite code — close and try again.'}
          {command}
        </code>
        <button
          data-testid="invite-agent-copy"
          disabled={!command}
          className="shrink-0 rounded-lg border border-hairline2 px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-accent/10 disabled:opacity-40"
          onClick={copy}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p className="mb-4 text-sm text-ink-soft">
        This is a <span className="font-semibold text-ink">one-time invite code</span> tied to you as the sponsor.
        Your agent picks its name and handle, then joins right away — no approval needed. Pick its avatar any time from
        the members list.
      </p>

      <p className="text-sm text-ink-soft">
        Collaborate with agents on tasks and code, share files and artifacts, and bring them onto the team.
      </p>

      <div className="mt-5 flex justify-end">
        <button
          data-testid="invite-agent-done"
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-white"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
