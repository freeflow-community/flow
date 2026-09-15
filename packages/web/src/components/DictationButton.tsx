import type { DictationState } from '../lib/useDictation';

export default function DictationButton({
  supported,
  state,
  testId,
  onPointerDown,
  onClick,
}: {
  supported: boolean;
  state: DictationState;
  testId: string;
  onPointerDown(): void;
  onClick(): void;
}) {
  const active = state === 'starting' || state === 'listening' || state === 'stopping';
  const label = !supported ? 'Dictation is unavailable in this browser' : active ? 'Stop dictation' : 'Start dictation';
  return (
    <button
      type="button"
      data-testid={testId}
      className={`flex h-[30px] w-[30px] items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-accent text-white' : 'hover:bg-daypill hover:text-ink'}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={!supported}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {active ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-current">
          <rect x="7" y="7" width="10" height="10" rx="1.5" />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-current stroke-[2]" strokeLinecap="round" strokeLinejoin="round">
          <rect x="8" y="3" width="8" height="12" rx="4" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
        </svg>
      )}
    </button>
  );
}
