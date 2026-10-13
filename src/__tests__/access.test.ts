import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccess } from '../access';

const TOKEN = 'sori_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

let store: Map<string, unknown>;
let calls: number;
let subscribed: boolean;

beforeEach(() => {
  store = new Map([['siteToken', TOKEN]]);
  calls = 0;
  subscribed = true;
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
  vi.stubGlobal('fetch', async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return new Response(JSON.stringify({ email: 'a@b.c', plan: subscribed ? 'monthly' : 'none', subscribed }), {
      status: 200,
    });
  });
});

describe('getAccess', () => {
  it('shares one /api/me between concurrent checks', async () => {
    const states = await Promise.all([getAccess(true), getAccess(true), getAccess()]);
    expect(calls).toBe(1);
    expect(states.every((s) => s.ok)).toBe(true);
  });

  it("with 'if-locked', asks the site again only for a refusal", async () => {
    await getAccess(true);
    await getAccess('if-locked');
    expect(calls).toBe(1);

    subscribed = false;
    await getAccess(true);
    expect(calls).toBe(2);
    subscribed = true;
    expect((await getAccess('if-locked')).ok).toBe(true);
    expect(calls).toBe(3);
  });
});
