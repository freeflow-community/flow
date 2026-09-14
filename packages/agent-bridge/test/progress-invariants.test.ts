// #528 — "the narration message disappears mid-turn". The sighting could not be
// reproduced against a live bridge on either client, so this file locks the two
// properties the report actually accuses `ProgressReporter` of breaking, at
// cadences a hand-driven repro never produces:
//
//   1. Rollover seals. Once a narration message is full and a second one opens,
//      the first is never edited or deleted again — its text is final.
//   2. Kinds never cross. A status-row write only ever targets the status row's
//      id, and a narration write only ever targets a narration id. A status edit
//      landing on the narration id is exactly what "the text vanished and a
//      thinking… row took its place" would look like.
//
// Both are asserted as properties over the whole ledger of writes rather than as
// expected call sequences, so they keep holding when the drain loop is
// rewritten. The third property in the family — narration only ever grows while
// the turn runs — is checked over the pre-finish prefix of the ledger, because
// the one legitimate shrink (dropping the tail block the reply is about to
// repeat) belongs to finish() by design.
import { describe, expect, it, vi } from 'vitest';
import { ProgressReporter } from '../src/progress.js';
import type { FlowApi } from '../src/api.js';
import type { FlowSocket } from '../src/gateway.js';

const NARRATION_MIN_INTERVAL_MS = 1500; // mirrors progress.ts
const NARRATION_MAX_CHARS = 2000; // mirrors progress.ts

type Op = { op: 'create' | 'edit' | 'delete'; id: string; body?: string };

const isStatus = (body: string): boolean => body.startsWith('🤖 *thinking…*');
const kindOf = (body: string): 'status' | 'narration' => (isStatus(body) ? 'status' : 'narration');

/**
 * A reporter over a recording API. `ops` is every write the turn made, in order
 * — the level the invariants are stated at. A rejected write records nothing,
 * which is what the server would have: the message as it was before.
 */
function makeRecorder(threadRootId: string | undefined) {
  const ops: Op[] = [];
  const logs: string[] = [];
  let failNextEdit = false;
  let n = 0;
  const api = {
    setChannelIndicator: vi.fn().mockResolvedValue({ state: null }),
    sendMessage: vi.fn(async (_channelId: string, body: string) => {
      const id = `msg-${++n}`;
      ops.push({ op: 'create', id, body });
      return { id };
    }),
    editMessage: vi.fn(async (id: string, body: string) => {
      if (failNextEdit) {
        failNextEdit = false;
        throw new Error('503 upstream');
      }
      ops.push({ op: 'edit', id, body });
      return {};
    }),
    deleteMessage: vi.fn(async (id: string) => void ops.push({ op: 'delete', id })),
  } as unknown as FlowApi;
  const socket = { sendTyping: vi.fn() } as unknown as FlowSocket;
  const reporter = new ProgressReporter(api, socket, 'thinking', true, 'chan-1', threadRootId, (m) => logs.push(m));
  return { reporter, ops, logs, failEditOnce: () => void (failNextEdit = true) };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
/**
 * Expire the narration throttle so the next block writes mid-turn. On fake
 * timers — sleeping for real would make one test cost 3s of wall clock and
 * starve the timing-sensitive suites running beside it.
 */
const expireThrottle = (): Promise<void> => vi.advanceTimersByTimeAsync(NARRATION_MIN_INTERVAL_MS + 50);

/** id → what it was created as. Every later op on it is checked against this. */
function kinds(ops: Op[]): Map<string, 'status' | 'narration'> {
  const kind = new Map<string, 'status' | 'narration'>();
  for (const op of ops) if (op.op === 'create') kind.set(op.id, kindOf(op.body!));
  return kind;
}

const narrationIds = (ops: Op[]): string[] =>
  ops.filter((o) => o.op === 'create' && kindOf(o.body!) === 'narration').map((o) => o.id);

/** (1) Rollover seals: nothing touches a narration message after its successor opens. */
function expectSealedNarrationUntouched(ops: Op[]): void {
  const ids = narrationIds(ops);
  for (let i = 0; i < ids.length - 1; i++) {
    const successorAt = ops.findIndex((o) => o.op === 'create' && o.id === ids[i + 1]);
    const touchedAfter = ops.slice(successorAt).filter((o) => o.id === ids[i]);
    expect({ sealed: ids[i], touchedAfter }).toEqual({ sealed: ids[i], touchedAfter: [] });
  }
}

/** (2) Kinds never cross: a write's body must match what its target was created as. */
function expectNoCrossKindWrites(ops: Op[]): void {
  const kind = kinds(ops);
  for (const op of ops) {
    if (op.op !== 'edit') continue;
    expect({ id: op.id, wrote: kindOf(op.body!) }).toEqual({ id: op.id, wrote: kind.get(op.id) });
  }
}

/** (3) Mid-turn, narration only grows: never emptied, never shortened, never deleted. */
function expectNarrationOnlyGrew(ops: Op[]): void {
  const kind = kinds(ops);
  const length = new Map<string, number>();
  for (const op of ops) {
    if (kind.get(op.id) !== 'narration') continue;
    expect({ id: op.id, removedMidTurn: op.op === 'delete' }).toEqual({ id: op.id, removedMidTurn: false });
    expect(op.body!.length).toBeGreaterThan(0);
    expect(op.body!.length).toBeGreaterThanOrEqual(length.get(op.id) ?? 0);
    length.set(op.id, op.body!.length);
  }
}

/**
 * (4) A rollover must not strand what the agent already said above the live
 * status row (#528). Ids are time-ordered, so a narration message opened after
 * the row renders below it; once that has happened the row belongs below them
 * all, or the turn's earlier commentary is cut off above a row that keeps
 * growing text underneath it.
 */
function expectRolloverDidNotStrandNarration(ops: Op[], preFinish: number): void {
  const kind = kinds(ops);
  const alive: string[] = [];
  for (const op of ops.slice(0, preFinish)) {
    if (op.op === 'create') alive.push(op.id);
    if (op.op === 'delete') {
      const at = alive.indexOf(op.id);
      if (at >= 0) alive.splice(at, 1);
    }
  }
  const narration = alive.filter((id) => kind.get(id) === 'narration');
  const status = alive.filter((id) => kind.get(id) === 'status');
  if (narration.length < 2 || status.length === 0) return; // nothing rolled over, or no row to strand it above
  expect({ rows: status.length, newest: alive[alive.length - 1] }).toEqual({ rows: 1, newest: status[0] });
}

function expectAllInvariants(ops: Op[], preFinish: number): void {
  expectSealedNarrationUntouched(ops);
  expectNoCrossKindWrites(ops);
  expectNarrationOnlyGrew(ops.slice(0, preFinish));
  expectRolloverDidNotStrandNarration(ops, preFinish);
}

describe('narration invariants (#528)', () => {
  it('never touches a sealed message when narration rolls over', async () => {
    const { reporter, ops } = makeRecorder('root-42');
    reporter.start();
    // Several messages' worth, arriving faster than the throttle drains them.
    for (let i = 0; i < 6; i++) reporter.onText(`${i}`.repeat(NARRATION_MAX_CHARS / 2));
    const preFinish = ops.length;
    await reporter.finish();

    expect(narrationIds(ops).length).toBeGreaterThan(1);
    expectAllInvariants(ops, preFinish);
  });

  it('holds when rollover lands mid-turn rather than in the final flush', async () => {
    const { reporter, ops } = makeRecorder(undefined);
    vi.useFakeTimers();
    try {
      reporter.start();
      reporter.onText('a'.repeat(1600));
      await vi.advanceTimersByTimeAsync(0);
      reporter.onText('b'.repeat(1600));
      await expireThrottle(); // the rollover happens here, with the turn still running
      reporter.onText('c'.repeat(200));
      await expireThrottle();
    } finally {
      vi.useRealTimers();
    }
    const preFinish = ops.length;
    await reporter.finish();

    expect(narrationIds(ops)).toHaveLength(2);
    // The sealed message was written once and never revisited; the live one grew.
    expect(ops.filter((o) => o.id === narrationIds(ops)[0])).toHaveLength(1);
    expectAllInvariants(ops, preFinish);
  });

  it('keeps status edits off the narration id under a fast tool cadence', async () => {
    // The shape that most nearly explains the report: the status row is edited
    // unthrottled, many times per narration write. If the two ids were ever
    // conflated, the narration body would be replaced by a thinking… line.
    const { reporter, ops } = makeRecorder(undefined);
    reporter.start();
    for (let i = 0; i < 12; i++) {
      reporter.onStep(`Bash: step ${i}`);
      if (i % 4 === 0) reporter.onText(`Block ${i}.`);
      await tick();
    }
    const preFinish = ops.length;
    await reporter.finish();

    expectAllInvariants(ops, preFinish);
    const status = ops.find((o) => o.op === 'create' && isStatus(o.body!))!;
    expect(ops.filter((o) => o.op === 'edit' && o.id === status.id).length).toBeGreaterThan(1);
  });

  it('holds in a thread, where the status row and the narration share a panel', async () => {
    const { reporter, ops } = makeRecorder('root-42');
    reporter.start();
    reporter.onText('Reading the parser.');
    await tick();
    reporter.onStep('Grep: writeNarration');
    await tick();
    reporter.onText('Found it.');
    const preFinish = ops.length;
    await reporter.finish('Found it.');

    expectAllInvariants(ops, preFinish);
  });

  it('deletes only the status row when the turn ends', async () => {
    // Acceptance criterion 3 read literally: finishing removes the ephemeral
    // row and leaves what the agent actually said standing.
    const { reporter, ops } = makeRecorder(undefined);
    reporter.start();
    reporter.onStep('Bash: pnpm test');
    await tick();
    reporter.onText('Tests are green.');
    await reporter.finish('All 41 passed.');

    const kind = kinds(ops);
    expect(ops.filter((o) => o.op === 'delete').map((o) => kind.get(o.id))).toEqual(['status']);
    expectNoCrossKindWrites(ops);
  });

  it('survives a rejected write without dropping or re-targeting the narration', async () => {
    // A failed edit leaves the message as the server last saw it. The retry must
    // not conclude the message is gone and post a second one, or land on the
    // status id — both would read as narration vanishing.
    const { reporter, ops, logs, failEditOnce } = makeRecorder(undefined);
    reporter.start();
    reporter.onStep('Bash: flaky');
    await tick();
    reporter.onText('First block.');
    await tick();
    failEditOnce();
    reporter.onText('Second block.');
    const preFinish = ops.length;
    await reporter.finish();

    expect(logs.some((l) => l.includes('relayed text failed'))).toBe(true);
    expect(narrationIds(ops)).toHaveLength(1);
    expectAllInvariants(ops, preFinish);
  });
  it('re-posts the status row below a narration message opened by rollover', async () => {
    // The bug (#528): ids are time-ordered, so the successor lands *below* the
    // live row and the first message is stranded above it — which in a
    // transcript that follows the bottom reads as the text disappearing while
    // the thinking line carries on updating.
    const { reporter, ops } = makeRecorder(undefined);
    vi.useFakeTimers();
    try {
      reporter.start();
      reporter.onStep('Read: progress.ts');
      await vi.advanceTimersByTimeAsync(0);
      reporter.onText('a'.repeat(1600));
      await expireThrottle();
      reporter.onText('b'.repeat(1600)); // rolls over
      await expireThrottle();
      reporter.onStep('Grep: writeNarration');
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
    const preFinish = ops.length;
    await reporter.finish();

    // The property first: nothing the agent said is left above the live row.
    expectAllInvariants(ops, preFinish);

    const [first, second] = narrationIds(ops);
    const rows = ops.filter((o) => o.op === 'create' && isStatus(o.body!)).map((o) => o.id);
    // One row was carried across the rollover: the original is gone, and the
    // one still standing is newer than both narration messages.
    expect(rows).toHaveLength(2);
    expect(ops.some((o) => o.op === 'delete' && o.id === rows[0])).toBe(true);
    const order = ops.filter((o) => o.op === 'create').map((o) => o.id);
    expect(order).toEqual([rows[0], first, second, rows[1]]);
    // …and it is still the row being edited, so the live indicator survived the move.
    expect(ops.some((o) => o.op === 'edit' && o.id === rows[1] && isStatus(o.body!))).toBe(true);
  });

  it('leaves the row alone on a turn that never rolls over', async () => {
    // The common case pays nothing: one status row, posted once, edited in place.
    const { reporter, ops } = makeRecorder(undefined);
    reporter.start();
    reporter.onStep('Bash: pnpm test');
    await tick();
    reporter.onText('Tests are green.');
    const preFinish = ops.length;
    await reporter.finish();

    expect(ops.filter((o) => o.op === 'create' && isStatus(o.body!))).toHaveLength(1);
    expect(ops.filter((o) => o.op === 'delete')).toHaveLength(1); // the row, at the end
    expectAllInvariants(ops, preFinish);
  });

  it('does not move the row during the final flush', async () => {
    // A rollover inside finish() must not re-post a row that is about to be
    // hard-deleted — that would leave a thinking… line below the real reply.
    const { reporter, ops } = makeRecorder(undefined);
    reporter.start();
    reporter.onStep('Bash: pnpm test');
    await tick();
    reporter.onText('c'.repeat(1600));
    reporter.onText('d'.repeat(1600)); // still queued when finish() flushes
    await reporter.finish();

    expect(narrationIds(ops).length).toBeGreaterThan(1);
    expect(ops.filter((o) => o.op === 'create' && isStatus(o.body!))).toHaveLength(1);
    const deletes = ops.filter((o) => o.op === 'delete').map((o) => kinds(ops).get(o.id));
    expect(deletes).toEqual(['status']);
  });
});
