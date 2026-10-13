/*
 * Slowing down after the site says "rate_limited" (HTTP 429).
 *
 * The site's budget for /api/analyze is a fixed window per account (120 per
 * hour today, src/server/ratelimit.ts on the site), with no Retry-After. So
 * asking again a few seconds later only earns another 429. Each refusal in a
 * row doubles the wait, from 2 minutes up to the length of the window; one
 * success resets it. A Retry-After sent by the site wins over the guess.
 *
 * The state is a plain object so the background can keep it in storage:
 * Chrome stops its service worker after 30 s of quiet, and a back-off held
 * only in memory would be forgotten by the next line.
 */

export const BACKOFF_BASE_MS = 2 * 60 * 1000;
export const BACKOFF_MAX_MS = 60 * 60 * 1000;

export interface BackoffState {
  /** No automatic request before this time (ms). 0 when none is due. */
  until: number;
  /** 429s in a row. */
  strikes: number;
}

export const NO_BACKOFF: BackoffState = { until: 0, strikes: 0 };

/** The state after a 429; `retryAfterMs` comes from a Retry-After header when there is one. */
export function afterRateLimit(state: BackoffState, now: number, retryAfterMs?: number): BackoffState {
  const strikes = state.strikes + 1;
  const guess = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (strikes - 1));
  const wait = retryAfterMs && retryAfterMs > 0 ? Math.min(BACKOFF_MAX_MS, retryAfterMs) : guess;
  return { until: now + wait, strikes };
}

export function isBackingOff(state: BackoffState, now: number): boolean {
  return now < state.until;
}

/** Retry-After as milliseconds: seconds or an HTTP date. Undefined when absent or unreadable. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1000 : undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) && at > now ? at - now : undefined;
}
