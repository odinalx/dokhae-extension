import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnalysisCache, memoryStore, type CacheStore } from '../analysisCache';
import { BackingOffError, CacheMissError, createAnalyzer } from '../analyzer';
import { NO_BACKOFF, type BackoffState } from '../backoff';
import { LineAnalyzer, type Outcome, type Send } from '../netflix/lines';
import type { AnalysisResult } from '../types';

/*
 * How many /api/analyze calls a Netflix viewing costs, before and after the
 * request work of perf/audit. Not a benchmark of speed: a count, on a fixed
 * sequence of 200 subtitle lines with what real viewing has (the same short
 * lines over and over, lines flashing past while scrubbing, a line replayed
 * with R), against a fake site that has the real budget (120 per account per
 * hour, a fixed window, every request counted, 429 past it) and answers in
 * 250 ms.
 *
 * "Before" is the policy the Netflix script had, copied here as it was:
 * a per-tab map, shared in-flight requests, a request the moment a line
 * appears, 3 minutes of silence after a 429, and a background that went
 * straight to the site. "After" is the shipped code: LineAnalyzer in the tab,
 * the analyzer and its persistent cache in the background.
 *
 * Run `npx vitest run src/__tests__/netflixRequests.test.ts` to see the table.
 */

const LATENCY_MS = 250;
const BUDGET = 120;
const WINDOW_MS = 60 * 60 * 1000;

interface Line {
  text: string;
  /** How long it stays on screen, ms. */
  shown: number;
  /** Quiet time before the next line, ms. */
  gap: number;
}

/** A fixed pseudo-random sequence (mulberry32), so the numbers never move. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMMON = [
  '네', '뭐?', '아니', '왜?', '진짜?', '괜찮아', '고마워', '알았어', '잠깐만', '어디 가?',
  '미안해', '그래', '뭐야', '정말?', '안녕', '여보세요?', '가자', '빨리 와', '됐어', '몰라',
];

/** 200 lines: ~30 % common short lines, ~8 % a line replayed with R, ~15 % flashes under 300 ms. */
function viewing(seed = 7): Line[] {
  const r = rng(seed);
  const lines: Line[] = [];
  let unique = 0;
  while (lines.length < 200) {
    const roll = r();
    let text: string;
    if (roll < 0.08 && lines.length > 1) text = lines[lines.length - 1]!.text;
    else if (roll < 0.38) text = COMMON[Math.floor(r() * COMMON.length)]!;
    else text = `대사 ${++unique} 번째 줄이야`;
    const flash = r() < 0.15;
    lines.push({
      text,
      shown: flash ? 60 + Math.floor(r() * 200) : 1200 + Math.floor(r() * 2300),
      gap: 100 + Math.floor(r() * 700),
    });
  }
  return lines;
}

/** The site: real budget (or none, to count the demand alone), real window, every request counted. */
function fakeSite(budget = BUDGET) {
  let windowEnd = 0;
  let count = 0;
  const stats = { requests: 0, refused: 0 };
  return {
    stats,
    async analyze(text: string): Promise<AnalysisResult> {
      stats.requests++;
      const now = Date.now();
      if (now > windowEnd) {
        windowEnd = now + WINDOW_MS;
        count = 0;
      }
      count++;
      await new Promise((r) => setTimeout(r, LATENCY_MS));
      if (count > budget) {
        stats.refused++;
        throw Object.assign(new Error('Trop'), { code: 'rate_limited' });
      }
      return { text, sentenceTranslation: `tr ${text}`, tone: '', words: [] };
    },
  };
}

interface Policy {
  show(text: string, onUpdate: () => void): void;
  leave(): void;
  has(text: string): boolean;
}

/** The Netflix script's policy before this branch (entrypoints/netflix.content.ts at 45df1bb). */
function beforePolicy(site: ReturnType<typeof fakeSite>): Policy {
  const cache = new Map<string, AnalysisResult>();
  const inflight = new Map<string, Promise<Outcome>>();
  let backoffUntil = 0;
  const analyse = (text: string): Promise<Outcome> => {
    const cached = cache.get(text);
    if (cached) return Promise.resolve({ ok: true, analysis: cached });
    if (Date.now() < backoffUntil) return Promise.resolve({ ok: false, message: '', code: 'rate_limited' });
    const pending = inflight.get(text);
    if (pending) return pending;
    const request = (async (): Promise<Outcome> => {
      try {
        const analysis = await site.analyze(text);
        cache.set(text, analysis);
        return { ok: true, analysis };
      } catch {
        backoffUntil = Date.now() + 3 * 60 * 1000;
        return { ok: false, message: '', code: 'rate_limited' };
      } finally {
        inflight.delete(text);
      }
    })();
    inflight.set(text, request);
    return request;
  };
  return {
    show: (text, onUpdate) => void analyse(text).then(onUpdate),
    leave: () => {},
    has: (text) => cache.has(text),
  };
}

/** The shipped code: LineAnalyzer in the tab, analyzer + persistent cache in the background. */
function afterPolicy(site: ReturnType<typeof fakeSite>, store: CacheStore, backoff: { state: BackoffState }): Policy {
  const analyzer = createAnalyzer({
    cache: createAnalysisCache(store),
    fetch: (text) => site.analyze(text),
    loadBackoff: async () => backoff.state,
    saveBackoff: async (s) => {
      backoff.state = s;
    },
  });
  // The message round trip to the background, as background.ts answers it.
  const send: Send = async (text, mode) => {
    try {
      return { ok: true, analysis: await analyzer.analyze(text, { mode }) };
    } catch (e) {
      if (e instanceof CacheMissError) return { ok: false, message: '', code: 'cache_miss' };
      if (e instanceof BackingOffError) return { ok: false, message: e.message, code: e.code, retryAt: e.retryAt };
      const err = e as { code?: string; retryAt?: number };
      return { ok: false, message: String(e), code: err.code, retryAt: err.retryAt };
    }
  };
  const lines = new LineAnalyzer(send, {
    timers: { set: (fn, ms) => setTimeout(fn, ms) as unknown as number, clear: (id) => clearTimeout(id) },
  });
  return {
    show: (text, onUpdate) => lines.show(text, onUpdate),
    leave: () => lines.leave(),
    has: (text) => lines.cached(text) !== undefined,
  };
}

/** Plays the lines through a policy; counts the readable lines (≥ 300 ms) that got their words in time. */
async function play(policy: Policy, lines: Line[]) {
  let readable = 0;
  let analysedInTime = 0;
  for (const line of lines) {
    let current = true;
    let got = policy.has(line.text);
    policy.show(line.text, () => {
      if (current && policy.has(line.text)) got = true;
    });
    await vi.advanceTimersByTimeAsync(line.shown);
    current = false;
    policy.leave();
    if (line.shown >= 300) {
      readable++;
      if (got) analysedInTime++;
    }
    await vi.advanceTimersByTimeAsync(line.gap);
  }
  return { readable, analysedInTime };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T20:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

async function compare(budget: number) {
  const lines = viewing();
  // One viewing, then the page reloaded and the same scenes watched again.
  const beforeSite = fakeSite(budget);
  const before1 = await play(beforePolicy(beforeSite), lines);
  const beforeOnce = { ...beforeSite.stats };
  const before2 = await play(beforePolicy(beforeSite), lines);

  const afterSite = fakeSite(budget);
  const store = memoryStore();
  const backoff = { state: NO_BACKOFF };
  const after1 = await play(afterPolicy(afterSite, store, backoff), lines);
  const afterOnce = { ...afterSite.stats };
  const after2 = await play(afterPolicy(afterSite, store, backoff), lines);
  return {
    before: { once: beforeOnce, twice: { ...beforeSite.stats }, first: before1, second: before2 },
    after: { once: afterOnce, twice: { ...afterSite.stats }, first: after1, second: after2 },
  };
}

function table(title: string, r: Awaited<ReturnType<typeof compare>>): string {
  const rows: (string | number)[][] = [
    ['', 'avant', 'après'],
    ['appels /api/analyze, 1 visionnage', r.before.once.requests, r.after.once.requests],
    ['  dont refusés (429)', r.before.once.refused, r.after.once.refused],
    ['appels, + rechargement et 2e visionnage', r.before.twice.requests, r.after.twice.requests],
    ['  dont refusés (429)', r.before.twice.refused, r.after.twice.refused],
    ['lignes lisibles analysées à temps, 1er', `${r.before.first.analysedInTime}/${r.before.first.readable}`, `${r.after.first.analysedInTime}/${r.after.first.readable}`],
    ['lignes lisibles analysées à temps, 2e', `${r.before.second.analysedInTime}/${r.before.second.readable}`, `${r.after.second.analysedInTime}/${r.after.second.readable}`],
  ];
  return `${title}\n` + rows.map((row) => row.map((c, i) => String(c).padEnd(i ? 8 : 42)).join(' ')).join('\n');
}

describe('Netflix request count, 200 lines', () => {
  it('needs far fewer calls after the change', async () => {
    const lines = viewing();
    const distinct = new Set(lines.map((l) => l.text)).size;
    const readableDistinct = new Set(lines.filter((l) => l.shown >= 300).map((l) => l.text)).size;
    const minutes = lines.reduce((t, l) => t + l.shown + l.gap, 0) / 60_000;

    const demand = await compare(Infinity);
    const quota = await compare(BUDGET);
    console.log(
      `200 répliques en ${minutes.toFixed(1)} min, ${distinct} distinctes, ${readableDistinct} distinctes affichées ≥ 300 ms\n\n` +
        table('Sans limite côté site (la demande seule)', demand) +
        '\n\n' +
        table(`Avec la limite du site (${BUDGET} par heure)`, quota),
    );

    // Without a limit: one request per distinct readable line, none for the second viewing.
    expect(demand.after.once.requests).toBe(readableDistinct);
    expect(demand.after.twice.requests).toBe(readableDistinct);
    expect(demand.after.once.requests).toBeLessThan(demand.before.once.requests);
    // With the limit: fewer refusals, and the second viewing reads from the cache.
    expect(quota.after.twice.refused).toBeLessThanOrEqual(quota.before.twice.refused);
    expect(quota.after.second.analysedInTime).toBe(quota.after.first.analysedInTime);
  }, 60_000);
});
