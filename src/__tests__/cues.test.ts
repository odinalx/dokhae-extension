import { describe, expect, it } from 'vitest';
import { CueHistory } from '../video/cues';

const starts = (h: CueHistory) => h.all().map((c) => [c.text, c.start]);

describe('CueHistory.record', () => {
  it('keeps lines in the order they start', () => {
    const h = new CueHistory();
    h.record('하나', 10);
    h.record('둘', 14);
    h.record('셋', 18);
    expect(starts(h)).toEqual([['하나', 10], ['둘', 14], ['셋', 18]]);
  });

  it('files a line seen after a seek back between the older ones', () => {
    const h = new CueHistory();
    h.record('하나', 10);
    h.record('셋', 18);
    h.record('둘', 14);
    expect(starts(h)).toEqual([['하나', 10], ['둘', 14], ['셋', 18]]);
  });

  it('merges a replayed line into its cue and keeps the earliest start', () => {
    const h = new CueHistory();
    const first = h.record('다시', 20.4);
    expect(h.record('다시', 19.9)).toBe(first);
    expect(h.record('다시', 20.1)).toBe(first);
    expect(starts(h)).toEqual([['다시', 19.9]]);
  });

  it('keeps the same words far apart as two cues', () => {
    const h = new CueHistory();
    h.record('네', 30);
    h.record('네', 300);
    expect(h.all()).toHaveLength(2);
  });

  it('forgets the furthest lines past its limit', () => {
    const h = new CueHistory();
    for (let i = 0; i < 3005; i++) h.record(`줄 ${i}`, i * 10);
    expect(h.all()).toHaveLength(3000);
    expect(h.all()[0]!.text).toBe('줄 5');
  });
});

describe('CueHistory navigation', () => {
  const sample = () => {
    const h = new CueHistory();
    const a = h.record('가', 10);
    const b = h.record('나', 15);
    const c = h.record('다', 20);
    return { h, a, b, c };
  };

  it('at: the last line started by then', () => {
    const { h, b } = sample();
    expect(h.at(5)).toBeNull();
    expect(h.at(16)).toBe(b);
  });

  it('previous with a line on screen: the one before it', () => {
    const { h, b, c } = sample();
    expect(h.previous(21, c)).toBe(b);
  });

  it('previous twice in a row walks back two lines', () => {
    const { h, a, b, c } = sample();
    const first = h.previous(21, c);
    expect(first).toBe(b);
    // The jump went to just before 15; nothing shows yet, the anchor is b.
    expect(h.previous(14.8, first)).toBe(a);
  });

  it('previous between lines: the one just missed', () => {
    const { h, c } = sample();
    expect(h.previous(23, null)).toBe(c);
  });

  it('previous on the first line stays on it', () => {
    const { h, a } = sample();
    expect(h.previous(11, a)).toBe(a);
  });

  it('replay: the anchor, or the last line shown', () => {
    const { h, b, c } = sample();
    expect(h.replay(16, b)).toBe(b);
    expect(h.replay(24, null)).toBe(c);
    expect(h.replay(2, null)).toBeNull();
  });

  it('ignores an anchor from before a clear', () => {
    const { h, c } = sample();
    h.clear();
    expect(h.previous(21, c)).toBeNull();
  });
});
