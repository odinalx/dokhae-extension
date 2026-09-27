import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'settings';

/**
 * The account token lives under its own key, not inside `settings`.
 *
 * The site rotates it once a day (see fetchAccount), and a page holding an
 * older copy of the settings, like the options page with unsaved edits,
 * would otherwise write the old token back on save. Using a replaced token
 * after its grace period is exactly what a copied token looks like, and the
 * site disconnects the device for it. So only the functions below write it.
 */
export const TOKEN_KEY = 'siteToken';
/** The token the last rotation replaced, to map a stale copy to the live one. */
const PREV_TOKEN_KEY = 'siteTokenPrev';

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get([KEY, TOKEN_KEY]);
  const settings = { ...DEFAULT_SETTINGS, ...(stored[KEY] as Partial<Settings> | undefined) };
  // Before 1.3 the token was stored inside the settings object.
  const token = typeof stored[TOKEN_KEY] === 'string' ? stored[TOKEN_KEY] : settings.siteToken;
  return { ...settings, siteToken: token };
}

/** Saves everything except the token, which setSiteToken owns. */
export async function saveSettings(settings: Settings): Promise<void> {
  const stored = await chrome.storage.local.get([KEY, TOKEN_KEY]);
  const legacy = (stored[KEY] as Partial<Settings> | undefined)?.siteToken;
  // Move a pre-1.3 token to its own key before the settings drop it.
  if (typeof stored[TOKEN_KEY] !== 'string' && legacy) {
    await chrome.storage.local.set({ [TOKEN_KEY]: legacy });
  }
  await chrome.storage.local.set({ [KEY]: { ...settings, siteToken: '' } });
}

export async function getSiteToken(): Promise<string> {
  return (await getSettings()).siteToken.trim();
}

/** A new connection (or a sign-out, with ''). */
export async function setSiteToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
  await chrome.storage.local.remove(PREV_TOKEN_KEY);
}

/**
 * Store the token the site just rotated to, only if `previous` is still the
 * live one: a connect that happened meanwhile must not be overwritten.
 */
export async function rotateSiteToken(previous: string, next: string): Promise<void> {
  if ((await getSiteToken()) !== previous) return;
  await chrome.storage.local.set({ [TOKEN_KEY]: next, [PREV_TOKEN_KEY]: previous });
}

/**
 * The token to send for a request started with `token`. A caller that read
 * the token before a rotation still holds the old one; it gets the live one
 * instead, since sending the old one late would look like a copy.
 */
export async function liveToken(token: string): Promise<string> {
  const stored = await chrome.storage.local.get([PREV_TOKEN_KEY]);
  return stored[PREV_TOKEN_KEY] === token ? await getSiteToken() : token;
}

export function hasVoiceCreds(s: Settings): boolean {
  return Boolean(s.voiceApiKeyId.trim() && s.voiceApiKey.trim());
}
