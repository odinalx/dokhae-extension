import type { AnalysisCache } from './analysisCache';
import { cacheKey } from './analysisCache';
import { afterRateLimit, isBackingOff, NO_BACKOFF, type BackoffState } from './backoff';
import type { AnalysisResult } from './types';

/*
 * Every analysis the background asks of the site goes through here, so the
 * rules that keep the request count down live in one place:
 *
 *   - a line already analysed is answered from the persistent cache;
 *   - two requests for the same line at once share one call;
 *   - after a 429, automatic requests (Netflix lines) wait out the back-off
 *     without touching the network; a reader's click still goes through.
 *
 * The site client and the storage are passed in, so the tests (and the
 * request count measurement) drive it without a browser.
 */

/**
 * - `cache`: answer from the cache or fail with a miss, never call the site.
 * - `auto`: asked by the extension itself (a Netflix line): held back while
 *   the site is rate limiting.
 * - `user`: the reader asked (a scan, a selection, a click on a line).
 */
export type AnalyzeMode = 'cache' | 'auto' | 'user';

export interface AnalyzerDeps {
  cache: AnalysisCache;
  /** The site call. Throws an error with `code: 'rate_limited'` on a 429. */
  fetch(text: string, uncertain?: number[]): Promise<AnalysisResult>;
  loadBackoff(): Promise<BackoffState>;
  saveBackoff(state: BackoffState): Promise<void>;
  now?: () => number;
}

/** Mode `cache` found nothing. */
export class CacheMissError extends Error {
  readonly code = 'cache_miss';
  constructor() {
    super('Pas encore analysée.');
  }
}

/** An automatic request held back by the back-off; `retryAt` says until when. */
export class BackingOffError extends Error {
  readonly code = 'rate_limited';
  constructor(readonly retryAt: number) {
    super('Trop d’analyses d’un coup. Dokhae reprend dans quelques minutes.');
  }
}

export interface Analyzer {
  analyze(text: string, opts?: { mode?: AnalyzeMode; uncertain?: number[] }): Promise<AnalysisResult>;
  /** When automatic requests may resume (0 when they may now). */
  retryAt(): Promise<number>;
}

export function createAnalyzer(deps: AnalyzerDeps): Analyzer {
  const now = deps.now ?? Date.now;
  const inflight = new Map<string, Promise<AnalysisResult>>();

  async function call(key: string, text: string, uncertain?: number[]): Promise<AnalysisResult> {
    try {
      const analysis = await deps.fetch(text, uncertain);
      // A scan's text may come back corrected: only plain text is reusable.
      if (!uncertain) await deps.cache.put(text, analysis);
      const backoff = await deps.loadBackoff();
      if (backoff.strikes) await deps.saveBackoff(NO_BACKOFF);
      return analysis;
    } catch (e) {
      const err = e as { code?: unknown; retryAfterMs?: unknown };
      if (err?.code === 'rate_limited') {
        const retryAfter = typeof err.retryAfterMs === 'number' ? err.retryAfterMs : undefined;
        const next = afterRateLimit(await deps.loadBackoff(), now(), retryAfter);
        await deps.saveBackoff(next);
        if (e instanceof Error) Object.assign(e, { retryAt: next.until });
      }
      throw e;
    } finally {
      inflight.delete(key);
    }
  }

  return {
    async analyze(text, opts = {}) {
      const mode = opts.mode ?? 'user';
      const uncertain = opts.uncertain;
      if (!uncertain) {
        const hit = await deps.cache.get(text);
        if (hit) return hit;
      }
      if (mode === 'cache') throw new CacheMissError();

      const key = uncertain ? `${text}\u0000${uncertain.join(',')}` : cacheKey(text);
      const pending = inflight.get(key);
      if (pending) return pending;

      if (mode === 'auto') {
        const backoff = await deps.loadBackoff();
        if (isBackingOff(backoff, now())) throw new BackingOffError(backoff.until);
      }
      // Checked again: the awaits above let a twin request start meanwhile.
      const twin = inflight.get(key);
      if (twin) return twin;
      const request = call(key, text, uncertain);
      inflight.set(key, request);
      return request;
    },

    async retryAt() {
      const backoff = await deps.loadBackoff();
      return isBackingOff(backoff, now()) ? backoff.until : 0;
    },
  };
}
