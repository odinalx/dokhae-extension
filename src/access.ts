import { SITE_URL } from './config';
import { getSettings } from './settings';
import { fetchAccount, revokedMessage, SiteApiError } from './site';

// Access: scanning needs a valid Dokhae token on an account with a plan. There
// is no free tier (the way in is a cheap first month), so a valid token on an
// account without a plan is locked with `not-subscribed`. The verdict is
// cached in storage so we don't hit the site on every scan; a short offline
// grace period keeps a flaky connection from locking a user out mid-session.

export type AccessReason = 'no-token' | 'invalid-token' | 'not-subscribed' | 'offline';

export interface AccessState {
  ok: boolean;
  reason?: AccessReason;
  email?: string;
  plan?: string;
  /** True on a paid plan. Without one the extension stays locked. */
  subscribed?: boolean;
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

/** Check (with caching) whether the extension is unlocked. */
export async function getAccess(force = false): Promise<AccessState> {
  const settings = await getSettings();
  const token = settings.siteToken.trim();
  if (!token) return { ok: false, reason: 'no-token', checkedAt: Date.now() };

  const cached = await readCache();
  if (!force && cached && Date.now() - cached.checkedAt < FRESH_MS) return cached;

  try {
    const account = await fetchAccount(token);
    const state: AccessState = account.subscribed
      ? {
          ok: true,
          email: account.email,
          plan: account.plan,
          subscribed: true,
          checkedAt: Date.now(),
        }
      : {
          ok: false,
          reason: 'not-subscribed',
          email: account.email,
          plan: 'none',
          subscribed: false,
          checkedAt: Date.now(),
        };
    await writeCache(state);
    return state;
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
    if (e.status === 401) return 'invalid-token';
  }
  return undefined;
}

/** Why the website deck is closed to this account, or null when it is open. */
export function deckLock(state: AccessState): AccessState | null {
  if (!state.ok) return state;
  if (!state.subscribed) return { ...state, ok: false, reason: 'not-subscribed' };
  return null;
}
