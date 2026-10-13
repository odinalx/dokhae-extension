import type { AnalysisResult } from './types';

/*
 * Analyses already paid for, kept across pages and restarts.
 *
 * Every /api/analyze call counts against the account's hourly budget on the
 * site (120 per hour, see the site's src/server/ratelimit.ts), and a Netflix
 * episode alone shows several hundred lines, many of them the same short
 * ones ("네", "뭐?", "괜찮아"). A line analysed once is answered here the next
 * time, whatever tab or session asks: the per-tab map of the Netflix script
 * forgot everything on reload.
 *
 * Only plain text is cached (a selection, a subtitle line). A scan sends the
 * OCR's unsure syllables along and the server may correct the text, so the
 * same bubble read twice is not the same request; scans are rare enough to
 * always go to the site.
 *
 * The entries live in IndexedDB in the extension's own origin (the
 * background, Chrome's service worker or Firefox's event page): it holds
 * thousands of entries without the 10 MB ceiling of chrome.storage.local and
 * without rewriting one big object on each insert. Where IndexedDB is
 * missing or refuses (a locked-down profile), the cache falls back to memory
 * and works for the life of the background.
 */

/** Bump when the shape of an analysis changes: older entries are then ignored. */
const VERSION = 1;
/** Entries kept at most; the oldest go first. ~3000 lines is two seasons of a series. */
export const MAX_ENTRIES = 3000;
/** The server's translations improve; an entry is asked again after this. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CacheEntry {
  k: string;
  /** When it was stored (ms). */
  t: number;
  v: AnalysisResult;
}

/** What the cache needs from storage; IndexedDB in the extension, a Map in tests. */
export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  put(entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  count(): Promise<number>;
  /** Removes the `n` oldest entries. */
  dropOldest(n: number): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The key for a line: Unicode NFC, whitespace collapsed, trimmed, plus the
 * answer language and the cache version. Netflix draws the same line with
 * different spacing from one sighting to the next, and the server trims and
 * cleans the text anyway, so these differences never change the analysis.
 */
export function cacheKey(text: string, lang = 'fr'): string {
  const clean = text.normalize('NFC').replace(/[\s ​]+/g, ' ').trim();
  return `v${VERSION}|${lang}|${clean}`;
}

export interface AnalysisCache {
  get(text: string): Promise<AnalysisResult | undefined>;
  put(text: string, analysis: AnalysisResult): Promise<void>;
  clear(): Promise<void>;
}

export function createAnalysisCache(
  store: CacheStore,
  opts: { maxEntries?: number; maxAgeMs?: number; now?: () => number } = {},
): AnalysisCache {
  const maxEntries = opts.maxEntries ?? MAX_ENTRIES;
  const maxAge = opts.maxAgeMs ?? MAX_AGE_MS;
  const now = opts.now ?? Date.now;
  // Counting on every insert is a full index walk in IndexedDB: count once,
  // then keep the number up to date, and trim a tenth at a time.
  let size: number | null = null;

  return {
    async get(text) {
      const key = cacheKey(text);
      try {
        const entry = await store.get(key);
        if (!entry) return undefined;
        if (now() - entry.t > maxAge) {
          await store.delete(key);
          if (size !== null) size = Math.max(0, size - 1);
          return undefined;
        }
        return entry.v;
      } catch (e) {
        console.warn('[Dokhae] analysis cache read failed:', e);
        return undefined;
      }
    },

    async put(text, analysis) {
      const key = cacheKey(text);
      try {
        if (size === null) size = await store.count();
        const existed = Boolean(await store.get(key));
        await store.put({ k: key, t: now(), v: analysis });
        if (!existed) size += 1;
        if (size > maxEntries) {
          const drop = size - maxEntries + Math.ceil(maxEntries / 10);
          await store.dropOldest(drop);
          size = await store.count();
        }
      } catch (e) {
        console.warn('[Dokhae] analysis cache write failed:', e);
      }
    },

    async clear() {
      size = 0;
      try {
        await store.clear();
      } catch (e) {
        console.warn('[Dokhae] analysis cache clear failed:', e);
      }
    },
  };
}

/** A Map behind the CacheStore interface: the fallback, and the tests' store. */
export function memoryStore(): CacheStore {
  const map = new Map<string, CacheEntry>();
  return {
    get: async (key) => map.get(key),
    put: async (entry) => {
      map.delete(entry.k);
      map.set(entry.k, entry);
    },
    delete: async (key) => {
      map.delete(key);
    },
    count: async () => map.size,
    dropOldest: async (n) => {
      const oldest = [...map.values()].sort((a, b) => a.t - b.t).slice(0, n);
      for (const e of oldest) map.delete(e.k);
    },
    clear: async () => map.clear(),
  };
}

const DB_NAME = 'dokhae';
const DB_STORE = 'analyses';

function promised<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The IndexedDB store, opened on first use. */
export function idbStore(): CacheStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(DB_STORE, { keyPath: 'k' });
        store.createIndex('t', 't');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    }).catch((e) => {
      db = null;
      throw e;
    });
    return db;
  };
  const tx = async (mode: IDBTransactionMode) => (await open()).transaction(DB_STORE, mode);

  return {
    async get(key) {
      return promised((await tx('readonly')).objectStore(DB_STORE).get(key)) as Promise<CacheEntry | undefined>;
    },
    async put(entry) {
      const t = await tx('readwrite');
      t.objectStore(DB_STORE).put(entry);
      await done(t);
    },
    async delete(key) {
      const t = await tx('readwrite');
      t.objectStore(DB_STORE).delete(key);
      await done(t);
    },
    async count() {
      return promised((await tx('readonly')).objectStore(DB_STORE).count());
    },
    async dropOldest(n) {
      const t = await tx('readwrite');
      let left = n;
      const cursor = t.objectStore(DB_STORE).index('t').openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || left <= 0) return;
        c.delete();
        left -= 1;
        c.continue();
      };
      await done(t);
    },
    async clear() {
      const t = await tx('readwrite');
      t.objectStore(DB_STORE).clear();
      await done(t);
    },
  };
}

/**
 * IndexedDB when it opens, memory otherwise. The first failure switches to
 * memory for good, so a profile without IndexedDB pays the error once.
 */
export function defaultStore(): CacheStore {
  const memory = memoryStore();
  if (typeof indexedDB === 'undefined') return memory;
  const idb = idbStore();
  let current: CacheStore = idb;
  const guard =
    <A extends unknown[], R>(op: (s: CacheStore) => (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await op(current)(...args);
      } catch (e) {
        if (current === memory) throw e;
        console.warn('[Dokhae] IndexedDB unavailable, analyses cached in memory only:', e);
        current = memory;
        return op(current)(...args);
      }
    };
  return {
    get: guard((s) => s.get),
    put: guard((s) => s.put),
    delete: guard((s) => s.delete),
    count: guard((s) => s.count),
    dropOldest: guard((s) => s.dropOldest),
    clear: guard((s) => s.clear),
  };
}

let shared: AnalysisCache | null = null;

/** The extension's cache (one per context; the background is the one that fills it). */
export function analysisCache(): AnalysisCache {
  shared ??= createAnalysisCache(defaultStore());
  return shared;
}
