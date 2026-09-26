import type {
  AnalysisResult,
  AnkiCardDraft,
  ExtensionMessage,
  FlashcardTarget,
  SelectionRect,
} from '../src/types';
import { getSettings, hasVoiceCreds, setSiteToken } from '../src/settings';
import { clovaTts } from '../src/clova';
import { naverWordAudioUrl } from '../src/naver';
import { sendCardsToAnki } from '../src/anki';
import {
  analyzeOnSite,
  fetchAccount,
  isRejectedCard,
  SiteApiError,
  sendCardToSite,
  sendCardsToSite,
} from '../src/site';
import { createQueue, withCard, withoutIds } from '../src/queue';
import { clearAccessCache, deckLock, getAccess, lockError, lockReason } from '../src/access';
import { SITE_URL } from '../src/config';
import { prepareForOcr } from '../src/ocrPrep';
import { CONNECT_PATH, isConnectPage, TOKEN_RE } from '../src/connect';
import type { Settings } from '../src/types';

const OFFSCREEN_URL = 'offscreen.html';
const CAPTURE_TIMEOUT_MS = 15_000;
const OFFSCREEN_TIMEOUT_MS = 15_000;
const OCR_TIMEOUT_MS = 120_000; // best model is slower
const SEGMENT_TIMEOUT_MS = 120_000; // first call builds the Kiwi neural model (slow once)

/**
 * Register a message listener that is allowed to decline.
 *
 * @types/webextension-polyfill models onMessage as a union of three shapes, and
 * the only one taking `sendResponse` must return exactly `true`. That leaves no
 * way to type the pattern this file is built on: five listeners on one event,
 * each returning a falsy value for messages that aren't theirs so the next one
 * gets a look. Both Chrome and Firefox document that return value, and the
 * async form is not a substitute — a listener returning a promise claims the
 * message, which would break the hand-off.
 *
 * So the cast lives here, once, instead of at five call sites.
 */
type DecliningListener = (
  message: unknown,
  sender: Parameters<Parameters<typeof browser.runtime.onMessage.addListener>[0]>[1],
  sendResponse: (response: unknown) => void,
) => true | undefined;

const onMessage = (listener: DecliningListener): void =>
  browser.runtime.onMessage.addListener(
    listener as Parameters<typeof browser.runtime.onMessage.addListener>[0],
  );

// Push a status line to the result panel (and the background console).
function report(status: string, progress: number) {
  console.log(`[Dokhae] ${status} (${Math.round(progress * 100)}%)`);
  chrome.runtime
    .sendMessage({ type: 'OCR_PROGRESS', status, progress } satisfies ExtensionMessage)
    .catch(() => {});
}

const CONTEXT_MENU_ID = 'wkr-analyze-selection';

export default defineBackground(() => {
  // --- Right-click "Analyser avec Dokhae" entry point ------------------------
  // Shown for any selection: hiding it for non-Korean text took a content
  // script on every page. Clicking it grants activeTab, which lets us inject
  // the content script and hand it the text; the panel then runs the same
  // pipeline as a scan, minus capture and OCR.
  chrome.runtime.onInstalled.addListener((details) => {
    // A fresh install goes straight to connecting the account, with the
    // how-to right after: installing and then finding nothing to do was the
    // first thing people hit.
    if (details.reason === 'install') {
      void chrome.tabs.create({ url: `${SITE_URL}${CONNECT_PATH}?welcome=1` });
    }
    // removeAll first: an update would otherwise keep the old hidden entry.
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: 'Analyser «\u00a0%s\u00a0» avec Dokhae',
        contexts: ['selection'],
      });
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || tab?.id == null) return;
    const text = (info.selectionText ?? '').trim();
    if (!text) return;
    sendToTab(tab.id, { type: 'ANALYZE_SELECTION', text }).catch((e) =>
      console.warn('[Dokhae] could not open the panel in this tab:', e),
    );
  });

  // --- Popup "Scanner" or "Analyser la sélection": inject into the active
  // tab, then open the scan overlay or the panel on the selected text ------
  onMessage((msg: unknown, _sender, sendResponse): true | undefined => {
    const message = msg as ExtensionMessage;
    if (message.type !== 'START_SCAN' && message.type !== 'ANALYZE_SELECTION_IN_TAB') return undefined;
    const toTab: ExtensionMessage =
      message.type === 'START_SCAN'
        ? { type: 'ACTIVATE_SCAN' }
        : { type: 'ANALYZE_SELECTION', text: message.text };
    sendToTab(message.tabId, toTab)
      .then(() => sendResponse({ type: 'START_SCAN_DONE', ok: true } satisfies ExtensionMessage))
      .catch((e) => {
        console.warn('[Dokhae] could not start a scan in this tab:', e);
        sendResponse({
          type: 'START_SCAN_DONE',
          ok: false,
          message:
            'Dokhae ne peut pas lire cette page. Chrome bloque les extensions sur ' +
            'les pages chrome://, le Web Store et les PDF.',
        } satisfies ExtensionMessage);
      });
    return true;
  });

  // --- Scan overlay opened: start the OCR engine while the user frames ---
  onMessage((msg: unknown): true | undefined => {
    const message = msg as ExtensionMessage;
    if (message.type !== 'OCR_WARM' || message.target) return undefined;
    (async () => {
      await ensureOffscreen();
      await chrome.runtime.sendMessage({ type: 'OCR_WARM', target: 'offscreen' } satisfies ExtensionMessage);
    })().catch((e) => console.warn('[Dokhae] OCR warm-up failed:', e));
    return undefined;
  });

  // --- One-click connect: the site's /connect-extension page hands a token ---
  // Only the connect content script sends this, and only from that page; the
  // sender check keeps any other page (or content script) from swapping the
  // account. The token is verified before it replaces the stored one, so a
  // stale or revoked token never logs out a working install.
  onMessage((msg: unknown, sender, sendResponse): true | undefined => {
    const message = msg as ExtensionMessage;
    if (message.type !== 'CONNECT_TOKEN') return undefined;
    const done = (reply: Omit<Extract<ExtensionMessage, { type: 'CONNECT_DONE' }>, 'type'>) =>
      sendResponse({ type: 'CONNECT_DONE', ...reply } satisfies ExtensionMessage);

    if (
      sender.id !== chrome.runtime.id ||
      !isConnectPage(sender.url, SITE_URL) ||
      !TOKEN_RE.test(message.token)
    ) {
      done({ ok: false, error: 'internal' });
      return undefined;
    }

    (async () => {
      try {
        const account = await fetchAccount(message.token);
        await setSiteToken(message.token);
        await clearAccessCache();
        // Warm the cache with the verdict we already have.
        await getAccess(true);
        done({ ok: true, email: account.email, subscribed: account.subscribed });
      } catch (e) {
        console.warn('[Dokhae] connect failed:', e);
        if (e instanceof SiteApiError && e.status === 401) done({ ok: false, error: 'invalid_token' });
        else if (e instanceof SiteApiError && e.status === 0) done({ ok: false, error: 'network' });
        else done({ ok: false, error: 'internal' });
      }
    })();
    return true;
  });

  // --- Paywall status for the popup / options page --------------------------
  onMessage(
    (msg: unknown, _sender, sendResponse): true | undefined => {
      const message = msg as ExtensionMessage;
      if (message.type !== 'ACCESS_CHECK') return undefined;

      (async () => {
        const state = await getAccess(message.force ?? false);
        sendResponse({
          type: 'ACCESS_INFO',
          ok: state.ok,
          reason: state.reason,
          email: state.email,
          plan: state.plan,
          subscribed: state.subscribed,
          revokedReason: state.revokedReason,
          siteUrl: SITE_URL,
        } satisfies ExtensionMessage);
      })();

      return true;
    }
  );

  onMessage(
    (msg: unknown, sender, sendResponse): true | undefined => {
      const message = msg as ExtensionMessage;
      if (message.type !== 'CAPTURE_REQUEST') return undefined;

      (async () => {
        try {
          // Scanning needs a valid token on an account with a plan.
          const access = await getAccess();
          if (!access.ok) throw lockError(access);

          const windowId = sender.tab?.windowId;
          if (windowId == null) throw new Error("Impossible de trouver la fenêtre active.");

          // --- Capture ---
          report('capture de l\'écran', 0.1);
          let dataUrl: string;
          try {
            dataUrl = await withTimeout(
              browser.tabs.captureVisibleTab(windowId, { format: 'png' }),
              CAPTURE_TIMEOUT_MS,
              'La capture d\'écran a pris trop de temps.'
            );
          } catch (e) {
            throw new Error(
              `Impossible de capturer la page. Chrome bloque la capture sur certaines ` +
                `pages (chrome://, le Web Store, les PDF). Détail\u00a0: ${describe(e)}`
            );
          }

          // --- Crop + preprocess ---
          report('recadrage', 0.25);
          let preprocessed: string;
          try {
            preprocessed = await prepareCapture(dataUrl, message.rect);
          } catch (e) {
            throw new Error(`Impossible de traiter l'image capturée\u00a0: ${describe(e)}`);
          }

          // --- OCR (local Tesseract) ---
          let ocr: { text: string; uncertain: number[] } = { text: '', uncertain: [] };
          try {
            ocr = await tesseractOcr(preprocessed);
          } catch (e) {
            console.error('[Dokhae] OCR failed:', e);
            throw new Error(`La lecture du texte a échoué\u00a0: ${describe(e)}`);
          }

          // --- Segmentation + translation + grammar (Dokhae server) ---
          report('analyse des mots', 0.8);
          const analysis = await analyzeText(ocr.text, ocr.uncertain);

          sendResponse({ type: 'CAPTURE_RESULT', analysis } satisfies ExtensionMessage);
        } catch (e) {
          console.error('[Dokhae] capture pipeline failed:', e);
          sendResponse({
            type: 'CAPTURE_ERROR', message: describe(e), reason: lockReason(e),
          } satisfies ExtensionMessage);
        }
      })();

      return true; // keep channel open for async sendResponse
    }
  );

  // --- Analyze selected text: same pipeline as a scan, minus capture/OCR ---
  onMessage(
    (msg: unknown, _sender, sendResponse): true | undefined => {
      const message = msg as ExtensionMessage;
      if (message.type !== 'ANALYZE_TEXT') return undefined;

      (async () => {
        try {
          // Same access rule as a scan.
          const access = await getAccess();
          if (!access.ok) throw lockError(access);

          report('analyse des mots', 0.8);
          const analysis = await analyzeText(message.text);

          sendResponse({ type: 'CAPTURE_RESULT', analysis } satisfies ExtensionMessage);
        } catch (e) {
          console.error('[Dokhae] analyze-text pipeline failed:', e);
          sendResponse({
            type: 'CAPTURE_ERROR', message: describe(e), reason: lockReason(e),
          } satisfies ExtensionMessage);
        }
      })();

      return true; // keep channel open for async sendResponse
    }
  );

  // --- Text-to-speech: fetch Google TTS audio, play it in the offscreen doc ---
  onMessage(
    (msg: unknown, _sender, sendResponse): true | undefined => {
      const message = msg as ExtensionMessage;
      if (message.type !== 'TTS_REQUEST') return undefined;

      (async () => {
        try {
          const settings = await getSettings();
          const audioDataUrl = await resolveTtsAudio(message.text, settings);
          await ensureOffscreen();
          await chrome.runtime.sendMessage({
            type: 'TTS_PLAY',
            target: 'offscreen',
            audioDataUrl,
          } satisfies ExtensionMessage);
          sendResponse({ type: 'TTS_DONE', ok: true } satisfies ExtensionMessage);
        } catch (e) {
          console.error('[Dokhae] TTS failed:', e);
          sendResponse({ type: 'TTS_DONE', ok: false, message: describe(e) } satisfies ExtensionMessage);
        }
      })();

      return true;
    }
  );

  // --- Anki card queue (session list) + AnkiConnect delivery ---
  onMessage(
    (msg: unknown, _sender, sendResponse): true | undefined => {
      const message = msg as ExtensionMessage;
      if (
        message.type !== 'ANKI_ADD' &&
        message.type !== 'ANKI_SEND_ALL' &&
        message.type !== 'ANKI_QUEUE' &&
        message.type !== 'ANKI_CLEAR'
      ) {
        return undefined;
      }

      (async () => {
        // Fallback for error responses if reading settings itself fails.
        let target: FlashcardTarget = 'site';
        try {
          const settings = await getSettings();
          target = settings.flashcardTarget;

          if (message.type === 'ANKI_QUEUE') {
            const cards = await getQueue();
            sendResponse({
              type: 'ANKI_QUEUE_INFO',
              count: cards.length,
              autoSend: settings.ankiAutoSend,
              target,
            } satisfies ExtensionMessage);
            return;
          }

          if (message.type === 'ANKI_CLEAR') {
            await queue.update(() => []);
            sendResponse({ type: 'ANKI_CLEAR_DONE', ok: true } satisfies ExtensionMessage);
            return;
          }

          if (message.type === 'ANKI_ADD') {
            const card: AnkiCardDraft = {
              ...message.card,
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              addedAt: Date.now(),
            };

            // Website destination (default): save straight to the Dokhae deck.
            // On failure the card stays in the queue so it's never lost.
            if (target === 'site') {
              try {
                const locked = deckLock(await getAccess());
                if (locked) throw lockError(locked);
                await sendCardToSite(settings.siteToken.trim(), card, settings.soriDeckId);
                sendResponse({
                  type: 'ANKI_ADD_DONE', ok: true, queued: (await getQueue()).length,
                  sentNow: true, target,
                } satisfies ExtensionMessage);
              } catch (e) {
                // A card the site rejects as invalid would fail forever: don't keep it.
                if (isRejectedCard(e)) {
                  sendResponse({
                    type: 'ANKI_ADD_DONE', ok: false, queued: (await getQueue()).length,
                    sentNow: false, target, message: 'Carte refusée par Dokhae (mot ou traduction invalide), elle n\'est pas gardée.',
                  } satisfies ExtensionMessage);
                  return;
                }
                const queued = await queue.update((q) => withCard(q, card));
                sendResponse({
                  type: 'ANKI_ADD_DONE', ok: false, queued: queued.length, sentNow: false,
                  target, message: `Gardée en attente, l'envoi vers Dokhae a échoué\u00a0: ${describe(e)}`,
                  reason: lockReason(e),
                } satisfies ExtensionMessage);
              }
              return;
            }

            // Anki auto-send mode: push straight into Anki; if that fails,
            // keep the card in the queue so it's never lost.
            if (settings.ankiAutoSend) {
              try {
                const r = await sendCardsToAnki(settings, [card], (t) => audioOrNull(t, settings));
                if (r.addedIds.length > 0) {
                  sendResponse({
                    type: 'ANKI_ADD_DONE', ok: true, queued: (await getQueue()).length, sentNow: true, target,
                  } satisfies ExtensionMessage);
                  return;
                }
                throw new Error(r.failures[0] || "Anki n'a pas accepté la carte.");
              } catch (e) {
                const queued = await queue.update((q) => withCard(q, card));
                sendResponse({
                  type: 'ANKI_ADD_DONE', ok: false, queued: queued.length, sentNow: false,
                  target, message: `Gardée en attente, l'envoi vers Anki a échoué\u00a0: ${describe(e)}`,
                } satisfies ExtensionMessage);
                return;
              }
            }

            const queued = await queue.update((q) => withCard(q, card));
            sendResponse({
              type: 'ANKI_ADD_DONE', ok: true, queued: queued.length, sentNow: false, target,
            } satisfies ExtensionMessage);
            return;
          }

          // ANKI_SEND_ALL — flush the queue to the configured destination.
          // Send a snapshot; cards added during the send stay queued because
          // only the ids handled here are removed, from a fresh read.
          const snapshot = await getQueue();
          if (snapshot.length === 0) {
            sendResponse({
              type: 'ANKI_SEND_ALL_DONE', ok: true, added: 0, failed: 0, remaining: 0, target,
            } satisfies ExtensionMessage);
            return;
          }
          if (target === 'site') {
            const locked = deckLock(await getAccess());
            if (locked) throw lockError(locked);
          }
          const result =
            target === 'site'
              ? await sendCardsToSite(settings.siteToken.trim(), snapshot, settings.soriDeckId)
              : { ...(await sendCardsToAnki(settings, snapshot, (t) => audioOrNull(t, settings))), droppedIds: [] };
          const remaining = await queue.update((q) =>
            withoutIds(q, [...result.addedIds, ...result.droppedIds]),
          );
          sendResponse({
            type: 'ANKI_SEND_ALL_DONE',
            ok: result.failed === 0,
            added: result.addedIds.length,
            failed: result.failed,
            dropped: result.droppedIds.length,
            remaining: remaining.length,
            target,
            message: result.failures[0],
          } satisfies ExtensionMessage);
        } catch (e) {
          console.error('[Dokhae] flashcard op failed:', e);
          if (message.type === 'ANKI_SEND_ALL') {
            const cards = await getQueue();
            sendResponse({
              type: 'ANKI_SEND_ALL_DONE', ok: false, added: 0, failed: cards.length,
              remaining: cards.length, target, message: describe(e),
            } satisfies ExtensionMessage);
          } else if (message.type === 'ANKI_ADD') {
            sendResponse({
              type: 'ANKI_ADD_DONE', ok: false, queued: (await getQueue()).length,
              sentNow: false, target, message: describe(e), reason: lockReason(e),
            } satisfies ExtensionMessage);
          } else if (message.type === 'ANKI_CLEAR') {
            sendResponse({ type: 'ANKI_CLEAR_DONE', ok: false } satisfies ExtensionMessage);
          } else {
            sendResponse({
              type: 'ANKI_QUEUE_INFO', count: 0, autoSend: false, target,
            } satisfies ExtensionMessage);
          }
        }
      })();

      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// Content script, injected on demand
// ---------------------------------------------------------------------------

/**
 * Deliver a message to Dokhae's content script in a tab, injecting it first if
 * the page doesn't have it yet. Works only while the extension holds
 * activeTab for that tab (the popup was opened or the context menu used on
 * it), which is exactly when the user asked for Dokhae.
 */
async function sendToTab(tabId: number, message: ExtensionMessage): Promise<void> {
  const present = await chrome.tabs
    .sendMessage(tabId, { type: 'PING' } satisfies ExtensionMessage)
    .then((r) => (r as ExtensionMessage | undefined)?.type === 'PONG')
    .catch(() => false);
  if (!present) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/content.js'],
    });
  }
  await chrome.tabs.sendMessage(tabId, message);
}

// ---------------------------------------------------------------------------
// Anki queue persistence
// ---------------------------------------------------------------------------

const ANKI_QUEUE_KEY = 'ankiQueue';

const queue = createQueue({
  async read() {
    const stored = await chrome.storage.local.get(ANKI_QUEUE_KEY);
    return (stored[ANKI_QUEUE_KEY] as AnkiCardDraft[] | undefined) ?? [];
  },
  async write(cards) {
    await chrome.storage.local.set({ [ANKI_QUEUE_KEY]: cards });
  },
});

const getQueue = queue.read;

// resolveTtsAudio wrapper that never throws — returns null when no audio.
async function audioOrNull(text: string, settings: Settings): Promise<string | null> {
  try {
    return await resolveTtsAudio(text, settings);
  } catch (e) {
    console.warn('[Dokhae] audio for Anki card failed:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Local OCR (Tesseract in the offscreen document)
// ---------------------------------------------------------------------------

async function tesseractOcr(
  preprocessed: string
): Promise<{ text: string; uncertain: number[] }> {
  report('démarrage de la lecture', 0.35);
  await withTimeout(ensureOffscreen(), OFFSCREEN_TIMEOUT_MS, 'Le moteur de lecture a mis trop de temps à démarrer.');

  report('lecture du texte', 0.4);
  const ocr = (await withTimeout(
    chrome.runtime.sendMessage({
      type: 'OCR_REQUEST',
      target: 'offscreen',
      imageDataUrl: preprocessed,
    } satisfies ExtensionMessage),
    OCR_TIMEOUT_MS,
    'La lecture a pris trop de temps. Essaie un cadre plus serré.'
  )) as ExtensionMessage | undefined;

  if (!ocr) throw new Error('Le moteur de lecture ne répond pas. Recharge la page et réessaie.');
  if (ocr.type === 'OCR_ERROR') throw new Error(ocr.message);
  return ocr.type === 'OCR_RESULT'
    ? { text: ocr.text, uncertain: ocr.uncertain ?? [] }
    : { text: '', uncertain: [] };
}

/**
 * Segment + translate + tag Korean text on the Dokhae server.
 *
 * This used to run entirely in-page: Kiwi's wasm in a sandboxed iframe (its
 * Emscripten glue needs `unsafe-eval`, which only a sandboxed page's CSP may
 * grant) driven from the offscreen document, with the model bytes transferred
 * in over postMessage. All of that — and the ~84 MB model shipped inside every
 * install — is now one HTTP call, shared with the mobile app.
 *
 * OCR stays local: it's free, works offline, and Tesseract handles the crisp
 * rendered text of a webtoon panel well.
 *
 * `uncertain` is only passed for Tesseract output: it tells the server the
 * text may hold look-alikes of syllables the model cannot print, and which
 * syllables were read with low confidence. Selected page text sends none.
 *
 * Empty text short-circuits. An error the site answered (or a network
 * failure) is rethrown with its French message; anything else degrades to
 * showing the recognised text with no analysis.
 */
async function analyzeText(raw: string, uncertain?: number[]): Promise<AnalysisResult> {
  const empty = { text: '', sentenceTranslation: '', tone: '', words: [] };
  if (!raw?.trim()) return empty;

  const { siteToken } = await getSettings();
  if (!siteToken) return { ...empty, text: raw };

  report('traduction', 0.85);
  try {
    return await analyzeOnSite(siteToken, raw, uncertain);
  } catch (e) {
    console.error('[Dokhae] analysis failed:', e);
    // The site said no (expired plan, rate limit, revoked token, unreachable):
    // show its French message instead of a silent, unanalysed result.
    if (e instanceof SiteApiError) {
      // The cached verdict said "subscribed", the server disagrees: drop the
      // cache so the popup rechecks and shows the paywall.
      if (e.code === 'subscription_required' || e.status === 401) await clearAccessCache();
      throw e;
    }
    return { ...empty, text: raw };
  }
}

// ---------------------------------------------------------------------------
// Text-to-speech
// ---------------------------------------------------------------------------

// Pick the best available voice:
//   1. Naver dictionary pronunciation (free, natural) — single dictionary words
//   2. Clova Voice (paid, if keys configured)
//   3. Google TTS (free, simple) — always works as a fallback
async function resolveTtsAudio(text: string, settings: Settings): Promise<string> {
  const word = text.trim();

  if (!/\s/.test(word)) {
    try {
      const naverUrl = await naverWordAudioUrl(word);
      if (naverUrl) return await fetchAudioAsDataUrl(naverUrl);
    } catch (e) {
      console.warn('[Dokhae] Naver dict audio failed:', e);
    }
  }

  if (hasVoiceCreds(settings)) {
    try {
      return await clovaTts(text, settings);
    } catch (e) {
      console.warn('[Dokhae] Clova Voice failed, falling back to Google TTS:', e);
    }
  }

  return fetchTts(text);
}

async function fetchAudioAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Audio HTTP ${res.status}`);
  return blobToDataUrl(await res.blob());
}

async function fetchTts(text: string): Promise<string> {
  const clean = text.trim().slice(0, 200);
  const ttsUrl =
    `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ko` +
    `&q=${encodeURIComponent(clean)}&textlen=${clean.length}`;
  const res = await fetch(ttsUrl);
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
  return blobToDataUrl(await res.blob());
}

// ---------------------------------------------------------------------------
// Offscreen document lifecycle
// ---------------------------------------------------------------------------

let creating: Promise<void> | null = null;

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing.length > 0) return;

  if (creating) {
    await creating;
    return;
  }

  try {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['WORKERS', 'AUDIO_PLAYBACK'] as chrome.offscreen.Reason[],
      justification: 'Run Tesseract OCR in a Web Worker and play pronunciation audio.',
    });
    await creating;
  } catch (e) {
    // A concurrent scan may have created it already; that specific error is benign.
    if (!String(e).includes('Only a single offscreen document')) {
      throw new Error(`Impossible de démarrer le moteur de lecture\u00a0: ${describe(e)}`);
    }
  } finally {
    creating = null;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

// ---------------------------------------------------------------------------
// Image processing
// ---------------------------------------------------------------------------

/**
 * Crop the selection out of the screenshot and ready it for Tesseract in one
 * canvas pass: crop, upscale x2 when small (Tesseract wants glyphs around
 * 30px tall), then the border cleanup of src/ocrPrep.ts. Encoded once.
 */
async function prepareCapture(dataUrl: string, rect: SelectionRect): Promise<string> {
  const dpr = rect.devicePixelRatio;
  const x = Math.round(rect.x * dpr);
  const y = Math.round(rect.y * dpr);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  const scale = w < 400 ? 2 : 1;

  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = new OffscreenCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, x, y, w, h, 0, 0, w * scale, h * scale);
  bitmap.close();

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const clean = prepareForOcr(pixels.data, canvas.width, canvas.height);
  canvas.width = clean.width;
  canvas.height = clean.height;
  ctx.putImageData(new ImageData(clean.data, clean.width, clean.height), 0, 0);
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const arr = new Uint8Array(buf);
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode(...arr.subarray(i, Math.min(i + chunk, arr.length)));
  }
  const mime = blob.type || 'application/octet-stream';
  return `data:${mime};base64,` + btoa(bin);
}
