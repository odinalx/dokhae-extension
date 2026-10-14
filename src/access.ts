import { SITE_URL } from './config';
import { getSettings } from './settings';
import { FREE_PER_DAY_FALLBACK, freeLimitMessage } from './freeLimit';
import { fetchAccount, revokedMessage, SiteApiError, type SiteAccount } from './site';

// Access: scanning needs a valid Dokhae token. An account with a plan is
// unlimited; one without gets a few analyses a day (the site counts them, see
// its src/server/quota.ts), and is locked with `free-limit` once they are
// spent, until the next day (UTC). The verdict is cached in storage so we
// don't hit the site on every scan; a short offline grace period keeps a flaky
// connection from locking a user out mid-session.
//
// `not-subscribed` is what an older site answered (subscription_required);
// it is kept so a refusal still shows the plans.

export type AccessReason = 'no-token' | 'invalid-token' | 'not-subscribed' | 'free-limit' | 'offline';

export interface AccessState {
  ok: boolean;
  reason?: AccessReason;
  email?: string;
  plan?: string;
  /** True on a paid plan. */
  subscribed?: boolean;
  /** Without a plan: analyses left today, and the daily allowance. */
  freeLeft?: number;
  freePerDay?: number;
  /** With `invalid-token`: the site disconnected this browser, and why. */
  revokedReason?: string;
  checkedAt: number; // when the site last gave a definitive answer
}

const CACHE_KEY = 'accessState';
const FRESH_MS = 10 * 60 * 1000; // trust a cached verdict this long
const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000; // stay unlocked offline this long

async function readCache(): Promise<AccessState | null> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  return (stored[CACHE_KEY] as AccessState | undefined) ?? null;
}

async function writeCache(state: AccessState): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: state });
}

/** Forget the cached verdict, e.g. when the API refuses a scan it allowed. */
export async function clearAccessCache(): Promise<void> {
  await chrome.storage.local.remove(CACHE_KEY);
}

/**
 * `true` always asks the site; `'if-locked'` asks only when the cached
 * verdict is a refusal (someone who just paid must not wait out the cache,
 * someone already unlocked costs no request); `false` trusts a fresh cache.
 */
export type AccessForce = boolean | 'if-locked';

// One /api/me at a time per token: the popup, a scan and a Netflix line
// asking together share the answer instead of racing to rotate the token.
const checking = new Map<string, Promise<AccessState>>();

/** Check (with caching) whether the extension is unlocked. */
export async function getAccess(force: AccessForce = false): Promise<AccessState> {
  const settings = await getSettings();
  const token = settings.siteToken.trim();
  if (!token) return { ok: false, reason: 'no-token', checkedAt: Date.now() };

  const cached = await readCache();
  const fresh = cached && Date.now() - cached.checkedAt < FRESH_MS;
  if (fresh && (force === false || (force === 'if-locked' && cached.ok))) return cached;

  const pending = checking.get(token);
  if (pending) return pending;
  const run = checkOnSite(token, cached).finally(() => checking.delete(token));
  checking.set(token, run);
  return run;
}

async function checkOnSite(token: string, cached: AccessState | null): Promise<AccessState> {
  try {
    return await rememberAccount(await fetchAccount(token));
  } catch (e) {
    if (e instanceof SiteApiError && e.status === 401) {
      const state: AccessState = {
        ok: false,
        reason: 'invalid-token',
        checkedAt: Date.now(),
        ...(e.code === 'device_revoked' ? { revokedReason: e.detail ?? 'user' } : {}),
      };
      await writeCache(state);
      return state;
    }
    // Network problem (or the site is down): honour the last definitive OK for
    // a while, otherwise report we're locked because we can't verify.
    if (cached?.ok && Date.now() - cached.checkedAt < OFFLINE_GRACE_MS) return cached;
    return { ok: false, reason: 'offline', checkedAt: cached?.checkedAt ?? 0 };
  }
}

/**
 * Cache the verdict for an account the site just described (GET /api/me),
 * so a caller that already has that answer does not ask again.
 */
export async function rememberAccount(account: SiteAccount): Promise<AccessState> {
  const state: AccessState = account.subscribed
    ? {
        ok: true,
        email: account.email,
        plan: account.plan,
        subscribed: true,
        checkedAt: Date.now(),
      }
    : freeState(account.email, account.freeLeft, account.freePerDay);
  await writeCache(state);
  return state;
}

function freeState(email: string | undefined, left: number, perDay: number): AccessState {
  return {
    ...(left > 0 ? { ok: true } : { ok: false, reason: 'free-limit' as const }),
    email,
    plan: 'none',
    subscribed: false,
    freeLeft: Math.max(0, left),
    freePerDay: perDay,
    checkedAt: Date.now(),
  };
}

/**
 * A free account just spent an analysis (the site said how many are left), or
 * was refused for having none (`left` 0): keep the cached verdict in step, so
 * the popup's counter is right and the next scan is refused without a request.
 */
export async function noteFreeLeft(left: number): Promise<void> {
  const cached = await readCache();
  if (!cached || cached.subscribed || cached.reason === 'no-token' || cached.reason === 'invalid-token') return;
  await writeCache(freeState(cached.email, left, cached.freePerDay ?? FREE_PER_DAY_FALLBACK));
}


/** Human message shown in the result panel / popup when locked. */
export function lockMessage(state: AccessState): string {
  switch (state.reason) {
    case 'no-token':
      return `Connecte ton compte Dokhae pour scanner et garder tes mots.`;
    case 'invalid-token':
      return state.revokedReason
        ? revokedMessage(state.revokedReason)
        : `Ton accès à Dokhae a expiré ou a été révoqué. Reconnecte ton compte.`;
    case 'not-subscribed':
      return `Scanner fait partie de l'abonnement Dokhae. Pour un nouveau compte, le premier mois est à 2,99\u00a0€.`;
    case 'free-limit':
      return freeLimitMessage(state.freePerDay);
    case 'offline':
      return `Impossible de vérifier ton abonnement (site injoignable). Vérifie ta connexion et réessaie.`;
    default:
      return `Dokhae est verrouillé. Connecte-toi sur ${SITE_URL} et vérifie ton abonnement.`;
  }
}

/**
 * A refusal the reader can fix (connect, subscribe, reconnect). Carries the
 * reason so the panel can offer the matching button instead of a bare URL.
 */
export class AccessLockedError extends Error {
  constructor(readonly reason: AccessReason, message: string) {
    super(message);
  }
}

export function lockError(state: AccessState): AccessLockedError {
  return new AccessLockedError(state.reason ?? 'no-token', lockMessage(state));
}

/** The access reason behind an error, when there is one to act on. */
export function lockReason(e: unknown): AccessReason | undefined {
  if (e instanceof AccessLockedError) return e.reason;
  if (e instanceof SiteApiError) {
    if (e.code === 'subscription_required') return 'not-subscribed';
    if (e.code === 'free_limit_reached') return 'free-limit';
    if (e.status === 401) return 'invalid-token';
  }
  return undefined;
}

/**
 * Why the website deck is closed to this account, or null when it is open.
 * It is open to free accounts too (their words go to their Parcours deck),
 * even once the day's analyses are spent: saving is not analysing.
 */
export function deckLock(state: AccessState): AccessState | null {
  if (state.ok || state.reason === 'free-limit') return null;
  return state;
}
