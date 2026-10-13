import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendCardsToSite } from '../site';
import type { AnkiCardDraft } from '../types';

const card = (id: string): AnkiCardDraft => ({
  id, word: id, wordTranslation: 'x', meanings: [], wordPos: '', sentence: '', sentenceTranslation: '', addedAt: 0,
});

let requests: { url: string; body: unknown }[];
let reply: (url: string, body: { words?: unknown[] }) => Response;

beforeEach(() => {
  requests = [];
  vi.stubGlobal('chrome', { storage: { local: { get: async () => ({}) } } });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}'));
    requests.push({ url, body });
    return reply(url, body);
  });
});

describe('sendCardsToSite', () => {
  it('sends the whole queue in one request and reads each verdict', async () => {
    reply = () =>
      new Response(JSON.stringify({ results: [{ status: 'added' }, { status: 'exists' }, { status: 'invalid' }] }));
    const r = await sendCardsToSite('sori_t', [card('a'), card('b'), card('c')], '7');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toMatch(/\/api\/cards\/batch$/);
    expect((requests[0]!.body as { words: { deckId: string }[] }).words[0]!.deckId).toBe('7');
    expect(r.addedIds).toEqual(['a', 'b']);
    expect(r.droppedIds).toEqual(['c']);
    expect(r.failed).toBe(1);
  });

  it('keeps every card when the batch fails', async () => {
    reply = () => new Response(JSON.stringify({ error: 'boom' }), { status: 502 });
    const r = await sendCardsToSite('sori_t', [card('a'), card('b')]);
    expect(r.addedIds).toEqual([]);
    expect(r.droppedIds).toEqual([]);
    expect(r.failed).toBe(2);
  });

  it('falls back to one card at a time on a site without the batch route', async () => {
    reply = (url) =>
      url.endsWith('/batch')
        ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify({ status: 'added' }));
    const r = await sendCardsToSite('sori_t', [card('a'), card('b')]);
    expect(requests.map((q) => q.url.replace(/^.*\/api/, '/api'))).toEqual(['/api/cards/batch', '/api/cards', '/api/cards']);
    expect(r.addedIds).toEqual(['a', 'b']);
  });
});
