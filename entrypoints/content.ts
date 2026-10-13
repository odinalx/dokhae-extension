import type { ExtensionMessage, SelectionRect } from '../src/types';
import { HANGUL_RE } from '../src/hangul';
import {
  createPanel as createSharedPanel,
  el,
  FONT_STACK,
  openPanel,
  renderResults,
  setPanelError,
  setPanelProgress,
  setPanelStatus,
} from '../src/panel';

let scanActive = false;
// Scans or analyses waiting on the background: progress only counts then,
// so a late report never replaces results already shown.
let working = 0;

// The panel as a scan opens it: "Scanner une autre bulle" at the bottom, and
// Escape left to the overlay while a new frame is being drawn.
const createPanel = () =>
  createSharedPanel({ onScanAgain: () => activateScan(), escapeBlocked: () => scanActive });

// Not declared in the manifest: the background injects this script into the
// current tab (chrome.scripting, under activeTab) when the user clicks Scanner
// in the popup or picks the context menu entry. Nothing of Dokhae runs on pages
// the user never asked it to read, and the extension needs no access to "all
// websites". Screenshot builds declare it on <all_urls>, as before, so the
// site's shoot.mjs can still message it directly.
export default defineContentScript({
  matches: __SORI_SCREENSHOTS__ ? ['<all_urls>'] : [],
  registration: __SORI_SCREENSHOTS__ ? 'manifest' : 'runtime',
  main() {
    // Injected again on every scan: listen once per page.
    const g = globalThis as { __soriContent?: boolean };
    if (g.__soriContent) return;
    g.__soriContent = true;

    browser.runtime.onMessage.addListener((msg: unknown) => {
      const message = msg as ExtensionMessage;
      if (message.type === 'PING') {
        return Promise.resolve({ type: 'PONG' } satisfies ExtensionMessage);
      } else if (message.type === 'ACTIVATE_SCAN' && !scanActive) {
        activateScan();
      } else if (message.type === 'ANALYZE_SELECTION') {
        runAnalyzeText(message.text);
      } else if (message.type === 'OCR_PROGRESS' && working > 0) {
        const panel = openPanel();
        if (panel) setPanelProgress(panel, message.status, message.progress);
      }
      return undefined;
    });
  },
});


// ---------------------------------------------------------------------------
// Capture overlay
// ---------------------------------------------------------------------------

function activateScan() {
  scanActive = true;
  // Load the OCR engine while the user frames the bubble: the first scan
  // otherwise waits for the wasm core and the 11 MB Korean model after the
  // capture.
  browser.runtime.sendMessage({ type: 'OCR_WARM' } satisfies ExtensionMessage).catch(() => {});

  const overlay = el('div', {
    position: 'fixed', top: '0', left: '0',
    width: '100vw', height: '100vh',
    background: 'rgba(20, 18, 26, 0.45)',
    zIndex: '2147483645',
    cursor: 'crosshair',
    userSelect: 'none',
    touchAction: 'none',
  });

  // Ink pill with cream text: the site's "ink" button, used here as a label.
  const hint = el('div', {
    position: 'fixed', top: '16px', left: '50%',
    transform: 'translateX(-50%)',
    background: '#16141a', color: '#f4f1e9',
    border: '1px solid #000000',
    padding: '9px 16px', borderRadius: '12px',
    fontFamily: FONT_STACK, fontSize: '14px', fontWeight: '600',
    lineHeight: '1.3', letterSpacing: '0',
    pointerEvents: 'none', zIndex: '2147483647',
    whiteSpace: 'nowrap', maxWidth: 'calc(100vw - 32px)',
    overflow: 'hidden', textOverflow: 'ellipsis',
  });
  hint.setAttribute('role', 'status');
  hint.textContent = 'Trace un cadre autour d’une bulle · Échap pour annuler';

  const selBox = el('div', {
    position: 'fixed', display: 'none',
    border: '2px solid #2f4bd8', background: 'transparent',
    borderRadius: '4px',
    // Once dragging starts, the box itself casts the dimming (a huge spread
    // shadow) and the overlay goes clear, so the bubble you are framing stays
    // at full brightness while the rest of the page recedes.
    boxShadow: '0 0 0 100vmax rgba(20, 18, 26, 0.45)',
    zIndex: '2147483646', pointerEvents: 'none', boxSizing: 'border-box',
  });

  document.body.append(hint, selBox, overlay);

  // Lock page scroll while selecting.
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  const blockScroll = (e: Event) => e.preventDefault();
  overlay.addEventListener('wheel', blockScroll, { passive: false });
  overlay.addEventListener('touchmove', blockScroll, { passive: false });

  let startX = 0, startY = 0, dragging = false;

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    Object.assign(selBox.style, { left: `${startX}px`, top: `${startY}px`, width: '0', height: '0', display: 'block' });
    overlay.style.background = 'transparent';
    e.preventDefault();
  };

  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    Object.assign(selBox.style, {
      left: `${x}px`, top: `${y}px`,
      width: `${Math.abs(e.clientX - startX)}px`,
      height: `${Math.abs(e.clientY - startY)}px`,
    });
  };

  const cleanup = () => {
    scanActive = false;
    document.documentElement.style.overflow = prevOverflow;
    overlay.removeEventListener('mousedown', onDown);
    overlay.removeEventListener('wheel', blockScroll);
    overlay.removeEventListener('touchmove', blockScroll);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('keydown', onKey);
    overlay.remove(); hint.remove(); selBox.remove();
  };

  const onUp = async (e: MouseEvent) => {
    if (!dragging) return;
    dragging = false;

    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    if (w < 10 || h < 10) { cleanup(); return; }
    cleanup();

    runCapture({ x, y, width: w, height: h, devicePixelRatio: window.devicePixelRatio || 1 });
  };

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup(); };

  overlay.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('keydown', onKey);
}

// ---------------------------------------------------------------------------
// Capture -> OCR -> render (with retry)
// ---------------------------------------------------------------------------

async function runCapture(rect: SelectionRect) {
  const panel = createPanel();
  setPanelStatus(panel, 'Capture en cours…');

  working++;
  try {
    const resp = (await browser.runtime.sendMessage({
      type: 'CAPTURE_REQUEST',
      rect,
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;

    if (!resp) {
      setPanelError(panel, 'L’extension ne répond pas. Recharge la page et réessaie.', () => runCapture(rect));
      return;
    }
    if (resp.type === 'CAPTURE_ERROR') { setPanelError(panel, resp.message, () => runCapture(rect), resp.reason); return; }
    if (resp.type !== 'CAPTURE_RESULT') return;

    renderResults(panel, resp.analysis);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes('message channel closed') || msg.includes('Extension context invalidated')) {
      setPanelError(panel, 'L’extension a été mise à jour. Actualise la page et réessaie.', () => runCapture(rect));
    } else {
      setPanelError(panel, msg, () => runCapture(rect));
    }
  } finally {
    working--;
  }
}

// ---------------------------------------------------------------------------
// Selected text -> analyze -> render (parallels runCapture, minus capture/OCR)
// ---------------------------------------------------------------------------

async function runAnalyzeText(text: string) {
  const clean = text.trim();
  if (!clean) return;

  const panel = createPanel();
  // The menu entry shows for any selection (hiding it for non-Korean text
  // took a content script on every page), so the check happens here.
  if (!HANGUL_RE.test(clean)) {
    setPanelError(panel, 'Cette sélection ne contient pas de coréen. Sélectionne une phrase en hangeul.');
    return;
  }
  setPanelStatus(panel, 'Analyse en cours…');

  const retry = () => runAnalyzeText(clean);
  working++;
  try {
    const resp = (await browser.runtime.sendMessage({
      type: 'ANALYZE_TEXT',
      text: clean,
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;

    if (!resp) {
      setPanelError(panel, 'L’extension ne répond pas. Recharge la page et réessaie.', retry);
      return;
    }
    if (resp.type === 'CAPTURE_ERROR') { setPanelError(panel, resp.message, retry, resp.reason); return; }
    if (resp.type !== 'CAPTURE_RESULT') return;

    renderResults(panel, resp.analysis);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (msg.includes('message channel closed') || msg.includes('Extension context invalidated')) {
      setPanelError(panel, 'L’extension a été mise à jour. Actualise la page et réessaie.', retry);
    } else {
      setPanelError(panel, msg, retry);
    }
  } finally {
    working--;
  }
}
