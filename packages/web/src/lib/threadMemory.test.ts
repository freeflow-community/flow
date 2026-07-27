import { describe, expect, it } from 'vitest';
import { createThreadMemory } from './threadMemory';

describe('threadMemory', () => {
  it('restores the thread a channel had open', () => {
    const m = createThreadMemory();
    m.remember('c1', 'root1');
    expect(m.recall('c1')).toBe('root1');
  });

  it('keeps channels independent', () => {
    const m = createThreadMemory();
    m.remember('c1', 'root1');
    m.remember('c2', 'root2');
    expect(m.recall('c1')).toBe('root1');
    expect(m.recall('c2')).toBe('root2');
    expect(m.recall('c3')).toBeNull();
  });

  it('forgets a channel whose thread was closed', () => {
    const m = createThreadMemory();
    m.remember('c1', 'root1');
    m.remember('c1', null);
    expect(m.recall('c1')).toBeNull();
  });

  it('replaces the remembered thread when another is opened', () => {
    const m = createThreadMemory();
    m.remember('c1', 'root1');
    m.remember('c1', 'root2');
    expect(m.recall('c1')).toBe('root2');
  });

  it('ignores a null channel (nothing selected yet)', () => {
    const m = createThreadMemory();
    m.remember(null, 'root1');
    expect(m.recall(null)).toBeNull();
  });

  it('forgets a single channel and clears them all', () => {
    const m = createThreadMemory();
    m.remember('c1', 'root1');
    m.remember('c2', 'root2');
    m.forget('c1');
    expect(m.recall('c1')).toBeNull();
    expect(m.recall('c2')).toBe('root2');
    m.clear();
    expect(m.recall('c2')).toBeNull();
  });
});
