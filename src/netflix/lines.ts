import type { AccessReason } from '../access';
import type { AnalyzeMode } from '../analyzer';
import type { AnalysisResult } from '../types';

/*
 * When the Netflix script asks for a line's analysis, and when it does not.
 *
 * Every distinct line used to cost a request the moment it appeared,
 * including the ones flashing past while the viewer scrubs or skips an
 * intro, and the budget on the site is 120 analyses per hour per account.
 * The rules now:
 *
 *   - a line known to this tab is shown at once, with no message at all;
 *   - otherwise the background's persistent cache is asked straight away
 *     (mode 'cache': never the network), so a line seen in another tab or
 *     session still shows at once;
 *   - the site is only asked once the line has stayed DWELL_MS on screen
 *     (mode 'auto'): a line gone before that was never read;
 *   - one request per line at a time, shared by everyone waiting on it;
 *   - nothing while the account is locked (signed out, no plan) until the
 *     sign-in or plan changes, and nothing during a back-off after a 429.
 *
 * DOM-free, so the tests and the request count measurement drive it with a
 * fake clock and a fake background.
 */

/** A line shown for less than this was not read: no request for it. */
export const DWELL_MS = 300;
/** After "rate_limited" without a date from the background, wait this long. */
export const RATE_LIMIT_FALLBACK_MS = 3 * 60 * 1000;
/** Analysed lines kept by the tab (a film is about 1500 lines). */
export const MEMORY_MAX = 2000;

export type Outcome =
  | { ok: true; analysis: AnalysisResult }
  | { ok: false; message: string; reason?: AccessReason; code?: string; retryAt?: number };

/** Asks the background (ANALYZE_TEXT) and turns its answer into an Outcome. */
export type Send = (text: string, mode: AnalyzeMode) => Promise<Outcome>;

export interface Timers {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export interface LineError {
  text: string;
  message: string;
  reason?: AccessReason;
}

export class LineAnalyzer {
  private memory = new Map<string, AnalysisResult>();
  private inflight = new Map<string, Promise<Outcome>>();
  private dwellTimer = 0;
  private current: string | null = null;
  /** Set when the account cannot analyse (signed out, no plan); cleared by unlock(). */
  locked: Extract<Outcome, { ok: false }> | null = null;
  backoffUntil = 0;
  lastError: LineError | null = null;

  constructor(
    private send: Send,
    private opts: { dwellMs?: number; now?: () => number; timers?: Timers } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private get timers(): Timers {
    return (
      this.opts.timers ?? {
        set: (fn, ms) => window.setTimeout(fn, ms),
        clear: (id) => window.clearTimeout(id),
      }
    );
  }

  cached(text: string): AnalysisResult | undefined {
    return this.memory.get(text);
  }

  isPending(text: string): boolean {
    return this.inflight.has(text);
  }

  backingOff(): boolean {
    return this.now() < this.backoffUntil;
  }

  /** The sign-in or the plan changed: ask again. */
  unlock(): void {
    this.locked = null;
    this.backoffUntil = 0;
  }

  /**
   * A line appeared. `onUpdate` runs when what is known about it changes
   * (an analysis arrived, or a refusal), if it is still the line on screen.
   */
  show(text: string, onUpdate: () => void): void {
    this.leave();
    this.current = text;
    if (this.memory.has(text) || this.locked) return;

    const settle = (outcome: Outcome) => {
      if (this.current === text && (outcome.ok || outcome.code !== 'cache_miss')) onUpdate();
    };
    void this.request(text, 'cache').then(settle);
    const dwell = this.opts.dwellMs ?? DWELL_MS;
    this.dwellTimer = this.timers.set(() => {
      this.dwellTimer = 0;
      if (this.current !== text || this.memory.has(text)) return;
      void this.analyse(text).then(settle);
    }, dwell);
  }

  /** The line left the screen. */
  leave(): void {
    if (this.dwellTimer) this.timers.clear(this.dwellTimer);
    this.dwellTimer = 0;
    this.current = null;
  }

  /**
   * The analysis of a line, from the tab's memory or the background. `force`
   * is a reader's click: it goes through a lock or a back-off.
   */
  analyse(text: string, force = false): Promise<Outcome> {
    const known = this.memory.get(text);
    if (known) return Promise.resolve({ ok: true, analysis: known });
    if (!force && this.locked) return Promise.resolve(this.locked);
    if (!force && this.backingOff()) {
      return Promise.resolve({ ok: false, message: '', code: 'rate_limited', retryAt: this.backoffUntil });
    }
    return this.request(text, force ? 'user' : 'auto');
  }

  private request(text: string, mode: AnalyzeMode): Promise<Outcome> {
    // A real request already running answers a cache lookup too.
    const pending = this.inflight.get(text);
    if (pending) return pending;
    const run = (async (): Promise<Outcome> => {
      let outcome: Outcome;
      try {
        outcome = await this.send(text, mode);
      } catch {
        outcome = { ok: false, message: 'L’extension a été mise à jour. Actualise la page et réessaie.' };
      }
      if (outcome.ok) {
        this.remember(text, outcome.analysis);
        if (this.lastError?.text === text) this.lastError = null;
        return outcome;
      }
      if (outcome.code === 'cache_miss') return outcome;
      if (outcome.reason && outcome.reason !== 'offline') this.locked = outcome;
      if (outcome.code === 'rate_limited') {
        this.backoffUntil = outcome.retryAt ?? this.now() + RATE_LIMIT_FALLBACK_MS;
      }
      this.lastError = { text, message: outcome.message, reason: outcome.reason };
      return outcome;
    })();
    if (mode !== 'cache') {
      this.inflight.set(text, run);
      void run.finally(() => {
        if (this.inflight.get(text) === run) this.inflight.delete(text);
      });
    }
    return run;
  }

  private remember(text: string, analysis: AnalysisResult) {
    this.memory.delete(text);
    if (this.memory.size >= MEMORY_MAX) {
      const oldest = this.memory.keys().next().value;
      if (oldest !== undefined) this.memory.delete(oldest);
    }
    this.memory.set(text, analysis);
  }
}
