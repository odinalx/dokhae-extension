import type { ExtensionMessage } from '../types';
import { describe } from '../describe';
import type { Engine } from './types';

/*
 * Chrome: the background is a service worker, which can neither start the
 * Tesseract Worker nor play audio, so both run in an offscreen document
 * (entrypoints/offscreen) that the background opens on demand and talks to
 * by message. Progress comes back as OCR_PROGRESS broadcasts from that page.
 */

const OFFSCREEN_URL = 'offscreen.html';

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
      throw new Error(`Impossible de démarrer le moteur de lecture : ${describe(e)}`);
    }
  } finally {
    creating = null;
  }
}

export const offscreenEngine: Engine = {
  async warm() {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ type: 'OCR_WARM', target: 'offscreen' } satisfies ExtensionMessage);
  },

  async recognize(imageDataUrl) {
    await ensureOffscreen();
    const ocr = (await chrome.runtime.sendMessage({
      type: 'OCR_REQUEST',
      target: 'offscreen',
      imageDataUrl,
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
    if (!ocr) throw new Error('Le moteur de lecture ne répond pas. Recharge la page et réessaie.');
    if (ocr.type === 'OCR_ERROR') throw new Error(ocr.message);
    return ocr.type === 'OCR_RESULT' ? { text: ocr.text, uncertain: ocr.uncertain ?? [] } : { text: '', uncertain: [] };
  },

  async play(audioDataUrl) {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ type: 'TTS_PLAY', target: 'offscreen', audioDataUrl } satisfies ExtensionMessage);
  },
};
