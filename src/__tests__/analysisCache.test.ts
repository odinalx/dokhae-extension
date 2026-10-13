import { describe, expect, it } from 'vitest';
import { cacheKey, createAnalysisCache, memoryStore } from '../analysisCache';
import type { AnalysisResult } from '../types';

const result = (text: string): AnalysisResult => ({ text, sentenceTranslation: `tr ${text}`, tone: '', words: [] });

describe('cacheKey', () => {
  it('ignores spacing differences and Unicode composition', () => {
    expect(cacheKey(' 뭐  해?\n')).toBe(cacheKey('뭐 해?'));
    // 한 written as decomposed jamo (NFD) is the same line.
    expect(cacheKey('한'.normalize('NFD'))).toBe(cacheKey('한'));
    expect(cacheKey('뭐 해?')).not.toBe(cacheKey('뭐해?'));
  });
});

describe('analysis cache', () => {
  it('answers a line stored earlier, whatever its spacing', async () => {
    const cache = createAnalysisCache(memoryStore());
    await cache.put('괜찮아', result('괜찮아'));
    expect((await cache.get(' 괜찮아 '))?.sentenceTranslation).toBe('tr 괜찮아');
    expect(await cache.get('안 괜찮아')).toBeUndefined();
  });

  it('forgets entries past their age', async () => {
    let now = 1_000;
    const cache = createAnalysisCache(memoryStore(), { maxAgeMs: 100, now: () => now });
    await cache.put('네', result('네'));
    now = 1_050;
    expect(await cache.get('네')).toBeDefined();
    now = 1_200;
    expect(await cache.get('네')).toBeUndefined();
  });

  it('stays under its size, dropping the oldest entries first', async () => {
    let now = 0;
    const store = memoryStore();
    const cache = createAnalysisCache(store, { maxEntries: 20, now: () => ++now });
    for (let i = 0; i < 50; i++) await cache.put(`줄 ${i}`, result(`줄 ${i}`));
    expect(await store.count()).toBeLessThanOrEqual(20);
    expect(await cache.get('줄 49')).toBeDefined();
    expect(await cache.get('줄 0')).toBeUndefined();
  });

  it('keeps working when its store fails', async () => {
    const broken = memoryStore();
    broken.get = async () => {
      throw new Error('disk');
    };
    const cache = createAnalysisCache(broken);
    await expect(cache.put('네', result('네'))).resolves.toBeUndefined();
    await expect(cache.get('네')).resolves.toBeUndefined();
  });
});
