// @vitest-environment happy-dom
import { act, useLayoutEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDeferredEditorFocus } from './dictationFocus';
import { useDictation, type DictationControls, type DictationEndReason } from './useDictation';
import type { BrowserSpeechRecognition, SpeechRecognitionResultEventLike } from './speechRecognition';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeRecognizer implements Partial<BrowserSpeechRecognition> {
  static instances: FakeRecognizer[] = [];
  onstart: (() => void) | null = null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  live: { onresult: FakeRecognizer['onresult'] } = { onresult: null };
  aborted = 0;
  constructor() {
    FakeRecognizer.instances.push(this);
  }
  start() {
    this.live = { onresult: this.onresult };
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.aborted += 1;
    this.onend?.();
  }
}

const final = (text: string): SpeechRecognitionResultEventLike => ({
  resultIndex: 0,
  results: [{ isFinal: true, 0: { transcript: text } }] as unknown as SpeechRecognitionResultEventLike['results'],
});

let root: Root;
let host: HTMLDivElement;
let events: { ends: DictationEndReason[]; transcripts: string[] };
let controls: DictationControls;

/** A stand-in for Composer: read-only editor while capturing, focus deferred to after re-render. */
function Harness({ ownerKey }: { ownerKey: string }) {
  const editor = useRef<HTMLDivElement>(null);
  const [focus] = useState(() => createDeferredEditorFocus<HTMLDivElement>(() => {}));
  const dictation = useDictation({
    ownerKey,
    onSessionStart: () => null,
    onFinalTranscript: (t) => {
      events.transcripts.push(t);
      return null;
    },
    onSessionEnd: (reason) => {
      events.ends.push(reason);
      // Composer requests focus while the editor is still non-editable.
      if (reason === 'stopped') focus.request(0);
    },
  });
  controls = dictation;
  useLayoutEffect(() => {
    if (!dictation.isActive) focus.flush(editor.current);
  }, [dictation.isActive, focus]);
  return (
    <div>
      <div ref={editor} data-testid="editor" contentEditable={dictation.isActive ? false : 'plaintext-only'} suppressContentEditableWarning />
      <button data-testid="mic" onClick={() => (dictation.isActive ? dictation.stop() : dictation.start())}>mic</button>
      <span data-testid="state">{dictation.state}</span>
    </div>
  );
}

const render = (ownerKey: string) => act(() => root.render(<Harness ownerKey={ownerKey} />));
const recognizer = () => FakeRecognizer.instances[FakeRecognizer.instances.length - 1]!;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement;

beforeEach(() => {
  FakeRecognizer.instances = [];
  events = { ends: [], transcripts: [] };
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognizer;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
});

describe('useDictation in a component', () => {
  it('cancels on owner change and ignores the old recognizer afterwards', () => {
    render('channel-a');
    act(() => controls.start());
    const r = recognizer();
    act(() => r.onstart?.());
    expect(q('state').textContent).toBe('listening');
    render('channel-b');
    expect(events.ends).toEqual(['owner-change']);
    expect(r.aborted).toBe(1);
    act(() => r.live.onresult?.(final('stale')));
    expect(events.transcripts).toEqual([]);
    expect(q('state').textContent).toBe('idle');
  });

  it('keeps the session across re-renders with the same owner', () => {
    render('channel-a');
    act(() => controls.start());
    render('channel-a');
    expect(events.ends).toEqual([]);
    expect(controls.isActive).toBe(true);
  });

  it('cancels on unmount', () => {
    render('channel-a');
    act(() => controls.start());
    const r = recognizer();
    act(() => root.unmount());
    expect(events.ends).toEqual(['unmount']);
    expect(r.aborted).toBe(1);
    root = createRoot(host); // afterEach unmounts again
  });

  it('cancels on pagehide while the page is still visible', () => {
    render('channel-a');
    act(() => controls.start());
    expect(document.visibilityState).toBe('visible');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(events.ends).toEqual(['hidden']);
  });

  it('cancels on Escape', () => {
    render('channel-a');
    act(() => controls.start());
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(events.ends).toEqual(['cancelled']);
  });

  it('returns focus to the editor after stopping, once it is editable again', () => {
    render('channel-a');
    act(() => q('mic').click());
    act(() => recognizer().onstart?.());
    expect((q('editor') as HTMLDivElement).isContentEditable).toBe(false);
    q('mic').focus();
    act(() => q('mic').click()); // Stop → synchronous end
    expect(events.ends).toEqual(['stopped']);
    expect((q('editor') as HTMLDivElement).isContentEditable).toBe(true);
    expect(document.activeElement).toBe(q('editor'));
  });
});
