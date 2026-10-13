import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LineAnalyzer, type Outcome, type Send } from '../netflix/lines';
import type { AnalysisResult } from '../types';

const result = (text: string): AnalysisResult => ({ text, sentenceTranslation: '', tone: '', words: [] });
const timers = {
  set: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clear: (id: number) => clearTimeout(id),
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function fakeBackground(answer: (text: string, mode: string) => Outcome = (t) => ({ ok: true, analysis: result(t) })) {
  const calls: { text: string; mode: string }[] = [];
  const send: Send = async (text, mode) => {
    calls.push({ text, mode });
    await new Promise((r) => setTimeout(r, 50));
    if (mode === 'cache') return { ok: false, message: '', code: 'cache_miss' };
    return answer(text, mode);
  };
  return { send, calls, site: () => calls.filter((c) => c.mode !== 'cache') };
}

describe('LineAnalyzer', () => {
  it('asks the site only for a line that stayed on screen', async () => {
    const bg = fakeBackground();
    const lines = new LineAnalyzer(bg.send, { timers });
    lines.show('지나가는 줄', () => {});
    await vi.advanceTimersByTimeAsync(200);
    lines.leave();
    await vi.advanceTimersByTimeAsync(1000);
    expect(bg.site()).toHaveLength(0);

    const update = vi.fn();
    lines.show('읽힌 줄', update);
    await vi.advanceTimersByTimeAsync(400);
    expect(bg.site()).toEqual([{ text: '읽힌 줄', mode: 'auto' }]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(lines.cached('읽힌 줄')).toBeDefined();
  });

  it('asks the background cache at once, and never twice for a known line', async () => {
    const bg = fakeBackground();
    const lines = new LineAnalyzer(bg.send, { timers });
    lines.show('네', () => {});
    expect(bg.calls[0]).toEqual({ text: '네', mode: 'cache' });
    await vi.advanceTimersByTimeAsync(500);
    lines.show('네', () => {});
    await vi.advanceTimersByTimeAsync(500);
    expect(bg.calls).toHaveLength(2);
  });

  it('shares a request between the dwell and a click', async () => {
    const bg = fakeBackground();
    const lines = new LineAnalyzer(bg.send, { timers, dwellMs: 0 });
    lines.show('같은 줄', () => {});
    await vi.advanceTimersByTimeAsync(1);
    const click = lines.analyse('같은 줄', true);
    await vi.advanceTimersByTimeAsync(100);
    await click;
    expect(bg.site()).toHaveLength(1);
  });

  it('stops asking once the account is locked, until unlocked', async () => {
    const bg = fakeBackground(() => ({ ok: false, message: 'Connecte ton compte', reason: 'no-token' }));
    const lines = new LineAnalyzer(bg.send, { timers });
    lines.show('하나', () => {});
    await vi.advanceTimersByTimeAsync(400);
    lines.show('둘', () => {});
    await vi.advanceTimersByTimeAsync(400);
    expect(bg.calls).toHaveLength(2); // the first line's cache lookup and its request
    expect(lines.locked?.reason).toBe('no-token');
    lines.unlock();
    lines.show('셋', () => {});
    await vi.advanceTimersByTimeAsync(400);
    expect(bg.site()).toHaveLength(2);
  });

  it('waits out a rate limit, but lets a click through', async () => {
    const bg = fakeBackground(() => ({ ok: false, message: 'Trop', code: 'rate_limited', retryAt: Date.now() + 60_000 }));
    const lines = new LineAnalyzer(bg.send, { timers });
    lines.show('하나', () => {});
    await vi.advanceTimersByTimeAsync(400);
    expect(lines.backingOff()).toBe(true);
    lines.show('둘', () => {});
    await vi.advanceTimersByTimeAsync(400);
    expect(bg.site()).toHaveLength(1);
    void lines.analyse('둘', true);
    await vi.advanceTimersByTimeAsync(100);
    expect(bg.site()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    lines.show('셋', () => {});
    await vi.advanceTimersByTimeAsync(400);
    expect(bg.site()).toHaveLength(3);
  });
});
