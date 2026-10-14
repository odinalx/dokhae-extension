import type { ExtensionMessage, AnalysisResult, WordInfo } from './types';
import { romanize } from './romanize';
import { phraseParts } from './phrase';
import { SITE_URL } from './config';
import { CONNECT_PATH } from './connect';
import { logoSvg } from './logo';
import type { AccessReason } from './access';

/*
 * The Dokhae result panel: the analysed sentence, its words, the word card and
 * "Ajouter au deck". Plain DOM in a closed Shadow DOM, injected over someone
 * else's page. The scan (entrypoints/content.ts) and the Netflix subtitles
 * (entrypoints/netflix.content.ts) both open it; what differs between them
 * goes through PanelOptions.
 */

export interface PanelOptions {
  /** Where the panel lives. Defaults to <body>; in fullscreen, the fullscreen element. */
  mount?: () => HTMLElement;
  /** Shows "Scanner une autre bulle" and runs it. */
  onScanAgain?: () => void;
  /** True while something else owns Escape (the scan overlay). */
  escapeBlocked?: () => boolean;
  /** Called once the panel is gone, whatever closed it. */
  onClose?: () => void;
  /** What a saved card records as its origin. Defaults to this page. */
  cardSource?: () => { source: string; sourceUrl: string };
}

let panelOptions: PanelOptions = {};
let currentAnalysis: AnalysisResult | null = null;

// ---------------------------------------------------------------------------
// SVG icons (no emoji)
// ---------------------------------------------------------------------------

export const ICON = {
  book: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M9 3v16"/></svg>`,
  speaker: `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" fill="currentColor"/></svg>`,
  external: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h2l1.5-2h7L19 5h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="13" cy="12" r="3.5"/></svg>`,
  check: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 9v6M9 12h6"/></svg>`,
  send: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>`,
};

// ---------------------------------------------------------------------------
// Part-of-speech → color (for word coloring)
// ---------------------------------------------------------------------------

// Same values as the site's deck, so a word keeps its colour from the page to
// the card. Keys stay English (they come from the analyser); only the labels
// shown to the reader are French.
const POS_COLORS: Record<string, string> = {
  noun: '#2f4bd8',
  pronoun: '#6478e0',
  verb: '#1f8a70',
  adjective: '#a8561c',
  adverb: '#c2701c',
  particle: '#9b97a6',
  numeral: '#5d6b8a',
  determiner: '#a1731c',
  interjection: '#c8412f',
  suffix: '#9b97a6',
  // Korean-specific classes the analyser also returns: shades of their parents.
  'auxiliary verb': '#4fa58c',
  'bound noun': '#6478e0',
  copula: '#4fa58c',
};

const POS_LABELS: Record<string, string> = {
  noun: 'nom',
  pronoun: 'pronom',
  verb: 'verbe',
  adjective: 'adjectif',
  adverb: 'adverbe',
  particle: 'particule',
  numeral: 'numéral',
  determiner: 'déterminant',
  interjection: 'interjection',
  suffix: 'suffixe',
  conjunction: 'conjonction',
  'auxiliary verb': 'verbe auxiliaire',
  'bound noun': 'nom dépendant',
  copula: 'copule',
};

export function posColor(pos: string): string {
  return POS_COLORS[pos] ?? '#9b97a6'; // unclassified words read as neutral
}

export function posLabel(pos: string): string {
  if (!pos || pos === 'other') return 'autre';
  return POS_LABELS[pos] ?? pos;
}

// ---------------------------------------------------------------------------
// Result panel (Shadow DOM for style isolation)
// ---------------------------------------------------------------------------

// Pretendard when the reader has it installed, the system face otherwise. The
// panel sits on arbitrary pages, so no remote font is ever loaded.
export const FONT_STACK = '"Pretendard Variable", Pretendard, system-ui, -apple-system, sans-serif';

// Escape closes the innermost layer first (word card, then the panel). Kept in
// a module variable so a new panel replaces the old listener instead of
// stacking another one.
let panelKeyHandler: ((e: KeyboardEvent) => void) | null = null;

// The panel's shadow root is closed, so the page can't read the words, the
// translation or the token-backed buttons through host.shadowRoot. This is
// the extension's only handle on it.
let panelShadow: ShadowRoot | null = null;

export function closePanel(shadow: ShadowRoot) {
  if (panelShadow !== shadow) {
    (shadow.host as HTMLElement).remove();
    return;
  }
  panelShadow = null;
  if (panelKeyHandler) {
    document.removeEventListener('keydown', panelKeyHandler, true);
    panelKeyHandler = null;
  }
  (shadow.host as HTMLElement).remove();
  const { onClose } = panelOptions;
  panelOptions = {};
  onClose?.();
}

/** The open panel, if any. */
export function openPanel(): ShadowRoot | null {
  return panelShadow;
}

export function createPanel(options: PanelOptions = {}): ShadowRoot {
  if (panelShadow) closePanel(panelShadow);
  document.getElementById('wkr-host')?.remove();
  panelOptions = options;

  const host = document.createElement('div');
  host.id = 'wkr-host';
  Object.assign(host.style, {
    position: 'fixed', top: '16px', right: '16px',
    width: '340px', maxWidth: 'calc(100vw - 32px)', zIndex: '2147483647',
    fontFamily: FONT_STACK,
  });
  (options.mount?.() ?? document.body).appendChild(host);

  // Screenshot builds keep it open so Playwright can click inside the panel.
  const shadow = host.attachShadow({ mode: __SORI_SCREENSHOTS__ ? 'open' : 'closed' });
  panelShadow = shadow;
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  shadow.appendChild(styleEl);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Dokhae');
  panel.innerHTML = `
    <div class="header">
      <span class="title">${logoSvg(22, 'title-mark')}<span>Dokhae</span></span>
      <button class="close icon-btn" title="Fermer (Échap)" aria-label="Fermer">${ICON.close}</button>
    </div>
    <div class="body" aria-live="polite"><div class="status">Capture en cours…</div></div>
  `;
  shadow.appendChild(panel);

  shadow.querySelector('.close')!.addEventListener('click', () => closePanel(shadow));
  makeDraggable(host, shadow.querySelector('.header') as HTMLElement);

  panelKeyHandler = (e: KeyboardEvent) => {
    // While a new selection is being drawn, Escape belongs to the overlay.
    if (e.key !== 'Escape' || panelOptions.escapeBlocked?.()) return;
    const pop = shadow.querySelector('.popover');
    if (pop) {
      (pop as HTMLElement & { _dismiss?: () => void })._dismiss?.();
    } else {
      closePanel(shadow);
    }
  };
  document.addEventListener('keydown', panelKeyHandler, true);

  return shadow;
}

export function setPanelStatus(shadow: ShadowRoot, msg: string) {
  (shadow.querySelector('.body') as HTMLElement).innerHTML =
    `<div class="status" role="status"><span class="spinner" aria-hidden="true"></span>${esc(msg)}</div>`;
}

export function setPanelProgress(shadow: ShadowRoot, status: string, progress: number) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  (shadow.querySelector('.body') as HTMLElement).innerHTML = `
    <div class="status" role="status"><span class="spinner" aria-hidden="true"></span>${esc(status)}…</div>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
      <div class="progress-bar" style="width:${pct}%"></div>
    </div>
    <div class="progress-pct">${pct} %</div>
  `;
}

// What the reader can do about a refusal, as a link to the right site page.
export function lockAction(reason: AccessReason | undefined): { label: string; href: string } | null {
  if (reason === 'no-token' || reason === 'invalid-token') {
    return { label: 'Connecter mon compte', href: `${SITE_URL}${CONNECT_PATH}` };
  }
  if (reason === 'not-subscribed' || reason === 'free-limit') {
    return { label: 'Voir les formules', href: `${SITE_URL}/pricing` };
  }
  return null;
}

export function setPanelError(shadow: ShadowRoot, msg: string, onRetry?: () => void, reason?: AccessReason) {
  const body = shadow.querySelector('.body') as HTMLElement;
  const action = lockAction(reason);
  // With a fix on offer, it leads; retrying becomes the quiet second choice.
  body.innerHTML = `
    <div class="error" role="alert">
      <span class="error-title">${reason === 'free-limit' ? 'Analyses du jour utilisées' : action ? 'Accès verrouillé' : 'Ça n’a pas marché'}</span>
      <span>${esc(msg)}</span>
    </div>
    ${action ? `<a class="btn btn-primary" href="${esc(action.href)}" target="_blank" rel="noreferrer">${esc(action.label)}</a>` : ''}
    ${onRetry ? `<button class="btn ${action ? 'btn-quiet' : 'btn-primary'} retry">${ICON.refresh}<span>Réessayer</span></button>` : ''}
  `;
  if (onRetry) {
    body.querySelector('.retry')!.addEventListener('click', onRetry);
  }
}

/**
 * Fill the panel with an analysis. `openWord` opens that word's card straight
 * away (a click on a subtitle word lands on its card, not on the sentence).
 */
export function renderResults(shadow: ShadowRoot, analysis: AnalysisResult, openWord?: number) {
  const body = shadow.querySelector('.body') as HTMLElement;
  currentAnalysis = analysis;

  const onScanAgain = panelOptions.onScanAgain;
  if (!analysis.text) {
    body.innerHTML = `
      <div class="status">Aucun texte détecté. Essaie un cadre plus serré autour de la bulle.</div>
      ${onScanAgain ? `<button class="btn btn-primary scan-again">${ICON.camera}<span>Scanner une autre bulle</span></button>` : ''}`;
    if (onScanAgain) body.querySelector('.scan-again')!.addEventListener('click', onScanAgain);
    return;
  }

  body.innerHTML = `
    <div class="phrase-card">
      <div class="phrase-head">
        <span class="label">Phrase</span>
        <button class="speak-all icon-btn" title="Écouter la phrase" aria-label="Écouter la phrase">${ICON.speaker}</button>
      </div>
      <div class="phrase" lang="ko"></div>
      <div class="legend"></div>
    </div>
    <button class="btn btn-quiet toggle-tr" aria-expanded="false">
      ${ICON.eye}<span class="toggle-label">Afficher la traduction</span>
    </button>
    <div class="translation hidden">
      <span class="label">Traduction</span>
      <div class="translation-text">${analysis.sentenceTranslation
        ? esc(analysis.sentenceTranslation)
        : '<span class="muted">Traduction indisponible</span>'}</div>
      ${analysis.tone ? `<div class="tone">Ton : ${esc(analysis.tone)}</div>` : ''}
    </div>
    ${onScanAgain ? `<button class="btn btn-quiet scan-again">${ICON.camera}<span>Scanner une autre bulle</span></button>` : ''}
    <div class="anki-bar"></div>
  `;

  // Flowing Korean phrase: each word is underlined in its part-of-speech
  // colour. Words are real buttons so Tab and Enter reach every one.
  const phraseEl = body.querySelector('.phrase') as HTMLElement;
  // Words sit inside the original sentence, so its commas, question and
  // exclamation marks stay visible between them (they are not clickable).
  const chips: HTMLElement[] = [];
  phraseParts(analysis.text, analysis.words.map((w) => w.surface)).forEach((part) => {
    if (part.kind === 'gap') {
      phraseEl.appendChild(document.createTextNode(part.text));
      return;
    }
    const info = analysis.words[part.index]!;
    const color = posColor(info.pos);
    const w = document.createElement('button');
    w.type = 'button';
    w.className = 'w';
    w.textContent = info.surface;
    w.title = posLabel(info.pos);
    w.style.setProperty('--c', color);
    w.addEventListener('click', () => {
      phraseEl.querySelectorAll('.w.active').forEach((e) => e.classList.remove('active'));
      w.classList.add('active');
      showWordPopover(shadow, w, info);
    });
    chips[part.index] = w;
    phraseEl.appendChild(w);
  });

  // Show / hide translation toggle.
  const tr = body.querySelector('.translation') as HTMLElement;
  const toggle = body.querySelector('.toggle-tr') as HTMLElement;
  const label = body.querySelector('.toggle-label') as HTMLElement;
  toggle.addEventListener('click', () => {
    const hidden = tr.classList.toggle('hidden');
    label.textContent = hidden ? 'Afficher la traduction' : 'Masquer la traduction';
    toggle.setAttribute('aria-expanded', String(!hidden));
  });

  body.querySelector('.speak-all')!.addEventListener('click', () => tts(analysis.text));
  if (onScanAgain) body.querySelector('.scan-again')!.addEventListener('click', onScanAgain);

  // Legend of the parts of speech actually present.
  const present = [...new Set(analysis.words.map((w) => w.pos || 'other'))];
  const legend = body.querySelector('.legend') as HTMLElement;
  legend.innerHTML = present
    .map((p) => {
      const c = posColor(p === 'other' ? '' : p);
      return `<span class="legend-item"><span class="dot" style="background:${c}"></span>${esc(posLabel(p))}</span>`;
    })
    .join('');

  void updateAnkiBar(shadow);

  if (openWord !== undefined) chips[openWord]?.click();
}

// ---------------------------------------------------------------------------
// Flashcard queue UI (footer bar of the result panel)
// ---------------------------------------------------------------------------

// Human name of the current destination ('site' → Dokhae, 'anki' → Anki).
function targetName(target: string | undefined): string {
  return target === 'anki' ? 'Anki' : 'Dokhae';
}

function cards(n: number, suffix = ''): string {
  return `${n} carte${n > 1 ? 's' : ''}${suffix ? ` ${suffix}${n > 1 ? 's' : ''}` : ''}`;
}

async function updateAnkiBar(shadow: ShadowRoot) {
  const bar = shadow.querySelector('.anki-bar') as HTMLElement | null;
  if (!bar) return;

  let count = 0;
  let target: string | undefined;
  try {
    const info = (await browser.runtime.sendMessage({
      type: 'ANKI_QUEUE',
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
    if (info && info.type === 'ANKI_QUEUE_INFO') {
      count = info.count;
      target = info.target;
    }
  } catch {
    /* background not ready: show the empty bar */
  }

  if (count === 0) {
    bar.innerHTML = `<span class="anki-count muted">Aucune carte en attente</span>`;
    return;
  }

  bar.innerHTML = `
    <span class="anki-count">${cards(count)} en attente</span>
    <div class="anki-actions">
      <button class="btn btn-quiet btn-sm anki-send">${ICON.send}<span>Tout envoyer vers ${targetName(target)}</span></button>
      <button class="anki-clear icon-btn" title="Vider la file" aria-label="Vider la file">${ICON.close}</button>
    </div>`;
  bar.querySelector('.anki-send')!.addEventListener('click', () => sendAllCards(shadow));
  bar.querySelector('.anki-clear')!.addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: 'ANKI_CLEAR' } satisfies ExtensionMessage).catch(() => {});
    void updateAnkiBar(shadow);
  });
}

async function sendAllCards(shadow: ShadowRoot) {
  const bar = shadow.querySelector('.anki-bar') as HTMLElement | null;
  if (!bar) return;
  bar.innerHTML = `<span class="anki-count muted">Envoi en cours…</span>`;

  let resp: ExtensionMessage | undefined;
  try {
    resp = (await browser.runtime.sendMessage({
      type: 'ANKI_SEND_ALL',
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
  } catch {
    resp = undefined;
  }

  if (!resp || resp.type !== 'ANKI_SEND_ALL_DONE') {
    bar.innerHTML = `<span class="anki-count warn">L’extension ne répond pas. Réessaie.</span>`;
    setTimeout(() => void updateAnkiBar(shadow), 2500);
    return;
  }

  const dest = targetName(resp.target);
  if (resp.ok && resp.failed === 0) {
    bar.innerHTML = `<span class="anki-count ok">${ICON.check}<span>${cards(resp.added, 'envoyée')} vers ${dest}</span></span>`;
  } else if (resp.added > 0 || resp.dropped) {
    // Cards the site rejected as invalid left the queue: say so, or the
    // count would silently shrink.
    const dropped = resp.dropped
      ? ` · ${cards(resp.dropped, 'refusée')} par Dokhae et retirée${resp.dropped > 1 ? 's' : ''} de la file`
      : '';
    const failedLeft = resp.failed - (resp.dropped ?? 0);
    const failed = failedLeft > 0 ? `, ${failedLeft} en échec` : '';
    bar.innerHTML = `<span class="anki-count warn">${cards(resp.added, 'envoyée')}${failed}${dropped} · ${resp.remaining} encore en attente.</span>`;
    setTimeout(() => void updateAnkiBar(shadow), 4000);
  } else {
    const why =
      resp.message ||
      (resp.target === 'anki'
        ? 'Impossible de joindre Anki. Ouvre-le avec le module AnkiConnect.'
        : 'Impossible de joindre Dokhae. Vérifie ta connexion et ton jeton d’accès.');
    bar.innerHTML = `<span class="anki-count warn">${esc(why)}</span>`;
    setTimeout(() => void updateAnkiBar(shadow), 4000);
  }
}

// ---------------------------------------------------------------------------
// Word detail popover
// ---------------------------------------------------------------------------

function showWordPopover(shadow: ShadowRoot, anchor: HTMLElement, info: WordInfo) {
  (shadow.querySelector('.popover') as (HTMLElement & { _dismiss?: () => void }) | null)?._dismiss?.();
  shadow.querySelector('.popover')?.remove();
  anchor.classList.add('active');

  const color = posColor(info.pos);
  const dictForm = info.infinitive || info.base;
  const sentence = currentAnalysis?.text || '';
  const sentenceTr = currentAnalysis?.sentenceTranslation || '';
  const pop = document.createElement('div') as HTMLElement & { _dismiss?: () => void };
  pop.className = 'popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', info.surface);
  pop.innerHTML = `
    <div class="pop-head">
      <span class="pop-word" lang="ko">${esc(info.surface)}</span>
      <button class="pop-close icon-btn" title="Fermer (Échap)" aria-label="Fermer">${ICON.close}</button>
    </div>
    <div class="pop-rom">
      ${info.pos ? `<span class="pop-badge" style="--c:${color}">${esc(posLabel(info.pos))}</span>` : ''}
      <span class="pop-rom-text">[${esc(romanize(info.surface))}]</span>
      <button class="pop-tts icon-btn" title="Prononcer" aria-label="Prononcer">${ICON.speaker}</button>
    </div>
    <div class="pop-trans">${info.translation ? esc(info.translation) : '<span class="muted">Pas de traduction</span>'}</div>
    ${dictForm && dictForm !== info.surface ? `<div class="pop-inf"><span class="label">Forme du dictionnaire</span><b lang="ko">${esc(dictForm)}</b><button class="pop-tts pop-tts-inf icon-btn" title="Prononcer la forme du dictionnaire" aria-label="Prononcer la forme du dictionnaire">${ICON.speaker}</button></div>` : ''}
    ${info.form ? `<div class="pop-form"><span class="label">Forme</span>${esc(info.form)}</div>` : ''}
    ${info.speechLevel ? `<div class="pop-form"><span class="label">Registre</span>${esc(info.speechLevel)}</div>` : ''}
    ${info.meanings.length > 1
      ? `<div class="pop-meanings-wrap"><span class="label">Autres sens</span><ul class="pop-meanings">${info.meanings.slice(0, 5).map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`
      : ''}
    ${sentence ? `<div class="pop-example">
      <div class="pop-example-ko" lang="ko">${highlightWord(sentence, info.surface, color)}</div>
      ${sentenceTr ? `<div class="pop-example-en">${esc(`« ${sentenceTr} »`)}</div>` : ''}
    </div>` : ''}
    <div class="pop-actions">
      <button class="btn btn-ink pop-flash">${ICON.plus}<span>Ajouter au deck</span></button>
      <div class="pop-note" role="status" aria-live="polite"></div>
    </div>
    <a class="pop-naver" target="_blank" rel="noreferrer" href="https://korean.dict.naver.com/koendict/#/search?range=all&query=${encodeURIComponent(info.infinitive || info.base || info.surface)}">
      ${ICON.external}<span>Ouvrir dans le dictionnaire Naver</span>
    </a>
  `;
  shadow.appendChild(pop);

  // Beside the panel when there is room (so the sentence and the panel stay
  // readable), otherwise under the clicked word; clamped inside the viewport,
  // whose width excludes the page scrollbar.
  const r = anchor.getBoundingClientRect();
  const panelRect = (shadow.host as HTMLElement).getBoundingClientRect();
  const margin = 8;
  const gap = 10;
  const viewW = document.documentElement.clientWidth || window.innerWidth;
  const viewH = document.documentElement.clientHeight || window.innerHeight;
  const { width: popW, height: popH } = pop.getBoundingClientRect();

  let left: number;
  let top: number;
  if (panelRect.left - gap - popW >= margin) {
    left = panelRect.left - gap - popW;
    top = r.top - 14;
  } else if (panelRect.right + gap + popW <= viewW - margin) {
    left = panelRect.right + gap;
    top = r.top - 14;
  } else {
    left = r.left;
    top = r.bottom + 6;
    if (top + popH > viewH - margin) top = r.top - popH - 6; // flip above the word
  }
  left = Math.max(margin, Math.min(left, viewW - popW - margin));
  top = Math.max(margin, Math.min(top, viewH - popH - margin));

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  // Close on outside click.
  const onDoc = (e: MouseEvent) => {
    const path = e.composedPath();
    if (!path.includes(pop) && !path.includes(anchor)) dismiss();
  };

  const dismiss = (returnFocus = false) => {
    document.removeEventListener('mousedown', onDoc);
    anchor.classList.remove('active');
    pop.remove();
    if (returnFocus && anchor.isConnected) anchor.focus();
  };
  pop._dismiss = () => dismiss(true);

  pop.querySelector('.pop-tts')!.addEventListener('click', () => tts(info.surface));
  if (dictForm) pop.querySelector('.pop-tts-inf')?.addEventListener('click', () => tts(dictForm));
  pop.querySelector('.pop-close')!.addEventListener('click', () => dismiss(true));

  const ankiBtn = pop.querySelector('.pop-flash') as HTMLButtonElement;
  // The icon is always the button's first element (an svg, or the spinner).
  const ankiIcon = () => ankiBtn.firstElementChild;
  const ankiLabel = ankiBtn.querySelector('span') as HTMLElement;
  const setIcon = (svg: string) => {
    const tmp = document.createElement('span');
    tmp.innerHTML = svg;
    ankiIcon()?.replaceWith(tmp.firstElementChild!);
  };
  const note = pop.querySelector('.pop-note') as HTMLElement;
  const setNote = (html: string, tone: '' | 'ok' | 'warn' = '') => {
    note.className = `pop-note${tone ? ` ${tone}` : ''}`;
    note.innerHTML = html;
  };
  ankiBtn.addEventListener('click', async () => {
    ankiBtn.disabled = true;
    ankiBtn.classList.remove('warn');
    ankiBtn.setAttribute('aria-busy', 'true');
    setIcon('<span class="spinner" aria-hidden="true"></span>');
    ankiLabel.textContent = 'Ajout…';
    setNote('');
    const card = {
      word: info.surface,
      base: info.base,
      wordTranslation: info.translation || '',
      meanings: info.meanings || [],
      wordPos: info.pos || '',
      infinitive: info.infinitive,
      sentence: currentAnalysis?.text || '',
      sentenceTranslation: currentAnalysis?.sentenceTranslation || '',
      // The exact page, so the site can link the word back to its chapter.
      ...(panelOptions.cardSource?.() ?? { source: location.hostname, sourceUrl: location.href }),
    };
    let resp: ExtensionMessage | undefined;
    try {
      resp = (await browser.runtime.sendMessage({
        type: 'ANKI_ADD', card,
      } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
    } catch {
      resp = undefined;
    }
    ankiBtn.removeAttribute('aria-busy');
    if (resp && resp.type === 'ANKI_ADD_DONE' && resp.ok) {
      ankiBtn.classList.add('done');
      setIcon(ICON.check);
      if (resp.sentNow && resp.target === 'site') {
        ankiLabel.textContent = 'Dans ton deck';
        setNote(`Ajoutée à tes révisions. <a href="${esc(`${SITE_URL}/deck`)}" target="_blank" rel="noreferrer">Voir mon deck</a>`, 'ok');
      } else if (resp.sentNow) {
        ankiLabel.textContent = 'Envoyée à Anki';
      } else {
        ankiLabel.textContent = 'Mise en attente';
        setNote('Elle part avec «\u00a0Tout envoyer\u00a0», en bas du panneau.');
      }
    } else {
      // The label stays short; the why goes underneath, with a fix when there is one.
      setIcon(ICON.refresh);
      ankiLabel.textContent = 'Réessayer';
      ankiBtn.classList.add('warn');
      ankiBtn.disabled = false;
      const msg =
        resp && resp.type === 'ANKI_ADD_DONE' ? (resp.message || 'Gardée en attente.') : 'L’extension ne répond pas. Recharge la page et réessaie.';
      const action = lockAction(resp && resp.type === 'ANKI_ADD_DONE' ? resp.reason : undefined);
      setNote(
        `${esc(msg)}${action ? ` <a href="${esc(action.href)}" target="_blank" rel="noreferrer">${esc(action.label)}</a>` : ''}`,
        'warn',
      );
    }
    void updateAnkiBar(shadow);
  });

  setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
  // Keyboard users land on the main action; Escape brings them back to the chip.
  ankiBtn.focus({ preventScroll: true });
}

// Wrap occurrences of `word` in the sentence with a POS-colored highlight span.
function highlightWord(sentence: string, word: string, color: string): string {
  const safe = esc(sentence);
  if (!word) return safe;
  return safe
    .split(esc(word))
    .join(`<span class="pop-hl" style="background:${hexA(color, 0.16)};box-shadow:inset 0 -2px 0 ${color}">${esc(word)}</span>`);
}

// ---------------------------------------------------------------------------
// Text-to-speech (routed through background → Google TTS; falls back locally)
// ---------------------------------------------------------------------------

export async function tts(text: string) {
  try {
    const resp = (await browser.runtime.sendMessage({
      type: 'TTS_REQUEST',
      text,
    } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
    if (resp && resp.type === 'TTS_DONE' && resp.ok) return;
    throw new Error(resp && resp.type === 'TTS_DONE' ? resp.message || 'la prononciation a échoué' : 'la prononciation a échoué');
  } catch {
    // Fallback to the browser's own voice (may be silent if none installed).
    try {
      speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = 'ko-KR';
      utt.rate = 0.85;
      speechSynthesis.speak(utt);
    } catch {
      /* nothing we can do */
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function esc(s: string) {
  // Quotes too: some escaped values land inside attributes (title, aria-label).
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// "#rrggbb" + alpha → rgba()
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function el(tag: string, styles: Partial<CSSStyleDeclaration>): HTMLElement {
  const e = document.createElement(tag);
  Object.assign(e.style, styles);
  return e;
}

export function makeDraggable(host: HTMLElement, handle: HTMLElement) {
  let startX = 0, startY = 0, startL = 0, startT = 0;
  handle.style.cursor = 'move';

  const onMove = (e: MouseEvent) => {
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.left = `${startL + (e.clientX - startX)}px`;
    host.style.top = `${startT + (e.clientY - startY)}px`;
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.close')) return;
    const rect = host.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startL = rect.left; startT = rect.top;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// Panel styles
// ---------------------------------------------------------------------------

export const STYLES = `
  :host {
    /* Dokhae's palette, same values as the popup and the site. This panel is
       injected over someone else's page, so it is the surface most people
       see. Everything is reset inside the shadow root so the host page's
       styles cannot leak in. */
    --wkr-accent: #2f4bd8;
    --wkr-accent-strong: #2438a8;
    --wkr-accent-soft: #e4e8fb;
    --wkr-celadon: #1f8a70;
    --wkr-celadon-strong: #176b57;
    --wkr-bg: #ffffff;
    --wkr-surface: #f4f1e9;
    --wkr-text: #16141a;
    --wkr-muted: #6a6675;
    --wkr-border: rgba(20, 18, 26, 0.14);
    --wkr-border-edge: rgba(20, 18, 26, 0.24);
    --wkr-ink: #16141a;
    --wkr-error: #c8412f;
    --wkr-error-strong: #9c3122;
    all: initial;
    display: block;
    font-family: ${FONT_STACK};
  }
  *, *::before, *::after { box-sizing: border-box; }
  button, a { font-family: inherit; }
  :focus { outline: none; }
  :focus-visible { outline: 2px solid var(--wkr-accent); outline-offset: 2px; }
  svg { flex: none; }

  .panel {
    font-family: ${FONT_STACK};
    background: var(--wkr-bg);
    color: var(--wkr-text);
    border: 1px solid var(--wkr-border);
    border-radius: 16px;
    box-shadow: 0 12px 28px -16px rgba(20, 18, 26, 0.35);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    max-height: min(560px, calc(100vh - 32px));
    font-size: 14px; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 10px 10px 14px;
    background: var(--wkr-bg);
    border-bottom: 1px solid var(--wkr-border);
    user-select: none;
  }
  .title {
    display: flex; align-items: baseline; gap: 7px;
    font-size: 14px; font-weight: 700; color: var(--wkr-text);
  }
  .title-mark { display: block; flex-shrink: 0; }

  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; flex: none;
    background: none; border: 1px solid transparent; color: var(--wkr-muted);
    cursor: pointer; padding: 0; border-radius: 10px;
    transition: transform 0.08s ease;
  }
  .icon-btn:hover { color: var(--wkr-text); background: var(--wkr-surface); }
  .icon-btn:active { transform: scale(0.97); }

  .body {
    padding: 12px; overflow-y: auto; flex: 1;
    display: flex; flex-direction: column; gap: 10px;
  }
  .label {
    display: block;
    font-size: 11px; font-weight: 600; line-height: 1.2;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--wkr-muted);
  }
  .status {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    color: var(--wkr-muted); font-size: 14px; text-align: center; padding: 18px 8px;
  }
  .spinner {
    display: inline-block; width: 14px; height: 14px; flex: none;
    border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
    animation: wkr-spin 0.7s linear infinite;
  }
  @keyframes wkr-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }
  .muted { color: var(--wkr-muted); }
  .error {
    color: var(--wkr-error-strong); font-size: 14px; padding: 10px 12px;
    background: #fbeeeb; border: 1px solid rgba(200, 65, 47, 0.3); border-radius: 12px;
    line-height: 1.5; word-break: break-word;
    display: flex; flex-direction: column; gap: 2px;
  }
  .error-title { font-weight: 700; }
  .progress { width: 100%; height: 6px; background: var(--wkr-surface); border-radius: 3px; overflow: hidden; }
  .progress-bar { height: 100%; background: var(--wkr-accent); border-radius: 3px; transition: width 0.2s ease; }
  .progress-pct { font-size: 11px; color: var(--wkr-muted); text-align: center; font-variant-numeric: tabular-nums; }

  /* Buttons: flat fill, 1px border in the pressed shade, press shrinks. */
  .btn {
    --fill: var(--wkr-accent); --edge: var(--wkr-accent-strong);
    display: flex; align-items: center; justify-content: center; gap: 7px;
    width: 100%; min-height: 38px; padding: 8px 14px;
    font-size: 14px; font-weight: 600; line-height: 1.2;
    color: #fff; background: var(--fill); border: 1px solid var(--edge);
    border-radius: 12px; cursor: pointer; text-decoration: none;
    transition: transform 0.08s ease, background-color 0.12s ease;
  }
  .btn:hover:not(:disabled) { background: var(--edge); }
  .btn:active:not(:disabled) { transform: scale(0.97); }
  .btn:disabled { cursor: default; }
  .btn-quiet { --fill: var(--wkr-bg); --edge: var(--wkr-border-edge); color: var(--wkr-text); }
  .btn-quiet:hover:not(:disabled) { background: var(--wkr-surface); }
  .btn-ink { --fill: var(--wkr-ink); --edge: #000000; color: var(--wkr-surface); }
  .btn-sm { width: auto; min-height: 30px; padding: 5px 10px; font-size: 12px; }

  .phrase-card {
    background: var(--wkr-surface); border: 1px solid var(--wkr-border);
    border-radius: 16px; padding: 10px 12px 12px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .phrase-head { display: flex; align-items: center; justify-content: space-between; margin: -2px -4px -2px 0; }
  .speak-all:hover { color: var(--wkr-accent-strong); background: var(--wkr-bg); }
  .phrase { display: block; line-height: 2.1; word-break: keep-all; }

  /* Words read as a sentence; a dotted underline in the part-of-speech colour
     carries the grammar, the same as on the website. */
  .phrase { font-size: 19px; color: var(--wkr-text); }
  .w {
    font-family: inherit; font-size: 19px; font-weight: 500; line-height: 1.3;
    color: var(--wkr-text); background: none; border: 0;
    border-radius: 5px; padding: 0 2px; margin: 0; cursor: pointer;
    text-decoration: underline dotted 2px;
    text-decoration-color: var(--c, var(--wkr-border-edge));
    text-underline-offset: 6px;
    transition: background-color 0.12s ease;
  }
  .w:hover { background: rgba(20, 18, 26, 0.06); }
  .w.active { background: var(--wkr-accent-soft); font-weight: 700; }

  .legend { display: flex; flex-wrap: wrap; gap: 4px 10px; }
  .legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--wkr-muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

  .translation {
    display: flex; flex-direction: column; gap: 4px;
    padding: 10px 12px; background: var(--wkr-accent-soft);
    border: 1px solid rgba(47, 75, 216, 0.18); border-radius: 12px;
  }
  .translation.hidden { display: none; }
  .translation .label { color: var(--wkr-accent-strong); }
  .translation-text { font-size: 16px; line-height: 1.5; color: var(--wkr-text); font-weight: 500; }
  .tone { font-size: 12px; color: var(--wkr-muted); }

  .anki-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin-top: 2px; padding-top: 10px; border-top: 1px solid var(--wkr-border);
    flex-wrap: wrap; min-height: 30px;
  }
  .anki-count { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--wkr-text); line-height: 1.4; }
  .anki-count.muted { color: var(--wkr-muted); }
  .anki-count.ok { color: var(--wkr-celadon-strong); font-weight: 600; }
  .anki-count.warn { color: var(--wkr-error-strong); }
  .anki-actions { display: flex; align-items: center; gap: 4px; }
  .anki-clear:hover { color: var(--wkr-error); }

  .popover {
    position: fixed; width: 290px; max-width: calc(100vw - 16px); z-index: 2147483647;
    max-height: calc(100vh - 16px); overflow-y: auto;
    font-family: ${FONT_STACK};
    font-size: 14px; line-height: 1.5; color: var(--wkr-text);
    background: var(--wkr-bg); border: 1px solid var(--wkr-border); border-radius: 16px;
    box-shadow: 0 12px 28px -16px rgba(20, 18, 26, 0.35);
    padding: 14px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .pop-head { display: flex; align-items: flex-start; gap: 8px; }
  .pop-word { font-size: 30px; font-weight: 700; line-height: 1.15; color: var(--wkr-text); flex: 1; word-break: keep-all; }
  .pop-close { margin: -4px -4px 0 0; }
  .pop-rom { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: -4px; }
  .pop-badge {
    font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 12px;
    color: var(--c, var(--wkr-muted)); background: var(--wkr-bg);
    border: 1px solid var(--c, var(--wkr-border-edge));
  }
  .pop-rom-text { font-size: 13px; color: var(--wkr-muted); }
  .pop-tts { width: 28px; height: 28px; }
  .pop-tts:hover { color: var(--wkr-accent-strong); }
  .pop-trans { font-size: 16px; font-weight: 600; color: var(--wkr-text); line-height: 1.4; }
  .pop-inf { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; }
  .pop-inf .label, .pop-form .label { display: inline; margin-right: 6px; }
  .pop-inf b { color: var(--wkr-text); font-weight: 700; }
  .pop-tts-inf { width: 26px; height: 26px; margin-left: -4px; }
  .pop-form { font-size: 13px; color: var(--wkr-text); }
  .pop-meanings-wrap { display: flex; flex-direction: column; gap: 4px; }
  .pop-meanings { margin: 0; padding-left: 18px; color: var(--wkr-muted); font-size: 13px; line-height: 1.5; }
  .pop-example {
    background: var(--wkr-surface); border: 1px solid var(--wkr-border); border-radius: 12px;
    padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
  }
  .pop-example-ko { font-size: 14px; line-height: 1.6; color: var(--wkr-text); word-break: keep-all; }
  .pop-hl { padding: 0 2px; border-radius: 3px; font-weight: 700; }
  .pop-example-en { font-size: 13px; color: var(--wkr-muted); line-height: 1.5; }
  .pop-actions { display: flex; flex-direction: column; gap: 6px; }
  .pop-note { font-size: 12px; line-height: 1.45; color: var(--wkr-muted); }
  .pop-note:empty { display: none; }
  .pop-note.ok { color: var(--wkr-celadon-strong); }
  .pop-note.warn { color: var(--wkr-error-strong); }
  .pop-note a { color: inherit; font-weight: 600; text-underline-offset: 2px; }
  .pop-flash.done { --fill: var(--wkr-celadon); --edge: var(--wkr-celadon-strong); color: #fff; }
  .pop-flash.warn { --fill: var(--wkr-bg); --edge: var(--wkr-error); color: var(--wkr-error-strong); }
  .pop-naver {
    display: flex; align-items: center; gap: 6px;
    color: var(--wkr-muted); text-decoration: none; font-size: 13px;
    padding-top: 10px; border-top: 1px solid var(--wkr-border); border-radius: 0;
  }
  .pop-naver:hover { color: var(--wkr-accent-strong); text-decoration: underline; }
`;
