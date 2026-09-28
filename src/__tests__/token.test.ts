import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettings, liveToken, rotateSiteToken, saveSettings, setSiteToken } from '../settings';
import { deviceName } from '../device';
import { DEFAULT_SETTINGS } from '../types';

// Minimal chrome.storage.local over a Map.
let store: Map<string, unknown>;
beforeEach(() => {
  store = new Map();
  const pick = (keys: string | string[]) =>
    Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string | string[]) => pick(keys),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        remove: async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
        },
      },
    },
  });
});

const OLD = 'sori_old_aaaaaaaaaaaaaaaaaaaaaaaa';
const NEW = 'sori_new_bbbbbbbbbbbbbbbbbbbbbbbb';

describe('site token storage', () => {
  it('moves a pre-1.3 token out of the settings object', async () => {
    store.set('settings', { ...DEFAULT_SETTINGS, siteToken: OLD, soriDeckId: '3' });
    expect((await getSettings()).siteToken).toBe(OLD);
    await saveSettings({ ...(await getSettings()), soriDeckId: '4' });
    expect((await getSettings()).siteToken).toBe(OLD);
    expect((store.get('settings') as { siteToken: string }).siteToken).toBe('');
  });

  it('never lets a settings save write a token back', async () => {
    await setSiteToken(OLD);
    const stale = await getSettings();
    await rotateSiteToken(OLD, NEW);
    await saveSettings(stale);
    expect((await getSettings()).siteToken).toBe(NEW);
  });

  it('rotates only from the live token', async () => {
    await setSiteToken(OLD);
    await rotateSiteToken('sori_other_ccccccccccccccccccccc', NEW);
    expect((await getSettings()).siteToken).toBe(OLD);
    await rotateSiteToken(OLD, NEW);
    expect((await getSettings()).siteToken).toBe(NEW);
  });

  it('maps a copy read before the rotation to the live token', async () => {
    await setSiteToken(OLD);
    await rotateSiteToken(OLD, NEW);
    expect(await liveToken(OLD)).toBe(NEW);
    expect(await liveToken(NEW)).toBe(NEW);
    await setSiteToken('');
    expect(await liveToken(OLD)).toBe(OLD);
  });
});

describe('deviceName', () => {
  it('names the browser and the system', () => {
    expect(
      deviceName({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36',
        userAgentData: { brands: [{ brand: 'Google Chrome' }], platform: 'Windows' },
      }),
    ).toBe('Chrome · Windows');
    expect(
      deviceName({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140 Safari/537.36 Edg/140' }),
    ).toBe('Edge · Mac');
    expect(
      deviceName({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0' }),
    ).toBe('Firefox · Linux');
  });
});
