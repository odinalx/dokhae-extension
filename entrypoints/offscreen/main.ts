import type { ExtensionMessage } from '../../src/types';
import { describe } from '../../src/describe';
import { recognizeKorean, warmOcr } from '../../src/tesseract';

// Chrome only (see index.html): Chrome's service worker cannot run Workers or
// play audio, so the background hands both to this hidden page. Firefox's
// background page does them itself (src/engine/direct.ts).

function reportProgress(status: string, progress: number) {
  // Fire-and-forget; ignore "no receiver" errors when no panel is listening.
  chrome.runtime
    .sendMessage({ type: 'OCR_PROGRESS', status, progress } satisfies ExtensionMessage)
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse): boolean => {
  const message = msg as ExtensionMessage;

  if (message.type === 'OCR_REQUEST' && message.target === 'offscreen') {
    recognizeKorean(message.imageDataUrl, reportProgress)
      .then(({ text, uncertain }) =>
        sendResponse({ type: 'OCR_RESULT', text, uncertain } satisfies ExtensionMessage),
      )
      .catch((e) => sendResponse({ type: 'OCR_ERROR', message: describe(e) } satisfies ExtensionMessage));
    return true; // async sendResponse
  }

  if (message.type === 'OCR_WARM' && message.target === 'offscreen') {
    // A failure resets the engine; the scan itself will retry and report it.
    warmOcr().catch((e) => console.warn('[Dokhae] OCR warm-up failed:', e));
    return false;
  }

  if (message.type === 'TTS_PLAY' && message.target === 'offscreen') {
    const audio = new Audio(message.audioDataUrl);
    audio.play().catch((e) => console.error('[Dokhae] audio play failed:', e));
    return false;
  }

  return false;
});
