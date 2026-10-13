import { describe, expect, it } from 'vitest';
import { createAnalysisCache, memoryStore } from '../analysisCache';
import { BackingOffError, CacheMissError, createAnalyzer } from '../analyzer';
import { afterRateLimit, BACKOFF_BASE_MS, BACKOFF_MAX_MS, NO_BACKOFF, parseRetryAfter, type BackoffState } from '../backoff';
import type { AnalysisResult } from '../types';

const result = (text: string): AnalysisResult => ({ text, sentenceTranslation: '', tone: '', words: [] });

function setup(opts: { fail?: (n: number) => Error | null } = {}) {
  let now = 1_000_000;
  let backoff: BackoffState = NO_BACKOFF;
  const calls: string[] = [];
  const analyzer = createAnalyzer({
    cache: createAnalysisCache(memoryStore(), { now: () => now }),
    async fetch(text) {
      calls.push(text);
      await Promise.resolve();
      const err = opts.fail?.(calls.length);
      if (err) throw err;
      return result(text);
    },
    loadBackoff: async () => backoff,
    saveBackoff: async (s) => {
      backoff = s;
    },
    now: () => now,
  });
  return {
    analyzer,
    calls,
    advance: (ms: number) => (now += ms),
    backoff: () => backoff,
  };
}

const rateLimited = () => Object.assign(new Error('429'), { code: 'rate_limited' });

describe('analyzer', () => {
  it('asks the site once per line, then answers from the cache', async () => {
    const { analyzer, calls } = setup();
    await analyzer.analyze('뭐 해?');
    await analyzer.analyze('뭐  해?');
    await analyzer.analyze('뭐 해?', { mode: 'auto' });
    expect(calls).toEqual(['뭐 해?']);
  });

  it('shares one request between concurrent asks for the same line', async () => {
    const { analyzer, calls } = setup();
    await Promise.all([analyzer.analyze('네'), analyzer.analyze('네'), analyzer.analyze(' 네')]);
    expect(calls).toHaveLength(1);
  });

  it('never calls the site in cache mode', async () => {
    const { analyzer, calls } = setup();
    await expect(analyzer.analyze('아니', { mode: 'cache' })).rejects.toBeInstanceOf(CacheMissError);
    expect(calls).toHaveLength(0);
  });

  it('does not cache scans, whose text the server may correct', async () => {
    const { analyzer, calls } = setup();
    await analyzer.analyze('어둠', { uncertain: [1] });
    await analyzer.analyze('어둠', { uncertain: [1] });
    expect(calls).toHaveLength(2);
  });

  it('holds automatic requests back after a 429, but lets the reader through', async () => {
    const { analyzer, calls, advance, backoff } = setup({ fail: (n) => (n === 1 ? rateLimited() : null) });
    await expect(analyzer.analyze('하나', { mode: 'auto' })).rejects.toMatchObject({ code: 'rate_limited' });
    expect(backoff().strikes).toBe(1);
    await expect(analyzer.analyze('둘', { mode: 'auto' })).rejects.toBeInstanceOf(BackingOffError);
    expect(calls).toHaveLength(1);
    // A click is the reader's call.
    await analyzer.analyze('둘', { mode: 'user' });
    expect(calls).toHaveLength(2);
    // That success ended the back-off.
    expect(backoff()).toEqual(NO_BACKOFF);
    advance(1);
    await analyzer.analyze('셋', { mode: 'auto' });
    expect(calls).toHaveLength(3);
  });
});

describe('back-off', () => {
  it('doubles with each 429 in a row, up to the window', () => {
    let s = NO_BACKOFF;
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      s = afterRateLimit(s, 0);
      waits.push(s.until);
    }
    expect(waits[0]).toBe(BACKOFF_BASE_MS);
    expect(waits[1]).toBe(BACKOFF_BASE_MS * 2);
    expect(waits.at(-1)).toBe(BACKOFF_MAX_MS);
  });

  it('follows Retry-After when the site sends it', () => {
    expect(afterRateLimit(NO_BACKOFF, 0, 30_000).until).toBe(30_000);
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBe(10_000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});
