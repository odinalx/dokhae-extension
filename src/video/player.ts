import type { AnalysisResult, ExtensionMessage, Settings } from '../types';
import type { AnalyzeMode } from '../analyzer';
import { HANGUL_RE } from '../hangul';
import { phraseParts } from '../phrase';
import { getSettings, saveSettings, TOKEN_KEY } from '../settings';
import {
  closePanel,
  createPanel,
  esc,
  FONT_STACK,
  lockAction,
  openPanel,
  posColor,
  posLabel,
  renderResults,
} from '../panel';
import { CueHistory, type Cue } from './cues';
import { LineAnalyzer, type Outcome } from './lines';
import type { SubtitleSite } from './site';
import { continues, subtitleText } from './text';

/*
 * A video site's Korean subtitles, redrawn by Dokhae: each line analysed by
 * the site (as a scan would be), every word clickable and underlined in the
 * colour of its part of speech. A click pauses the video and opens the usual
 * Dokhae panel on that word; closing it resumes playback.
 *
 * Only what the player already shows is read (the site's SubtitleSite): no
 * subtitle file, no video. The content scripts match the whole site because
 * Netflix and YouTube are single-page apps: going from the catalogue to a
 * video never loads a new page. The player stays idle away from a video.
 *
 * Shortcuts while watching (none of them is the player's own, except T, which
 * YouTube uses for theatre mode and which is only taken once a Korean line has
 * been seen): A previous line, R replay the line, T show or hide the
 * translation, P pause at the end of each line.
 */

/** Seek this far before a line starts, so its first syllable is not clipped. */
const SEEK_LEAD = 0.3;
/** A jump's target stays the anchor of the next A/R this long (see CueHistory.previous). */
const JUMP_ANCHOR_MS = 2500;
/** A line gone for less than this was a redraw, not the end of the line. */
const LINE_END_DEBOUNCE_MS = 150;
/** How many times the shortcut reminder shows, across sessions. */
const HINT_SHOWS = 3;
const SETTINGS_KEY = 'settings';
const ACCESS_KEY = 'accessState';

/** Marks the player's own subtitle layer while Dokhae draws in its place. */
const HIDDEN_ATTR = 'data-dokhae-hidden';

/**
 * Set on <html> while the subtitles are Korean: the player may replace its
 * layer between two lines, and the class keeps the new one hidden before
 * Dokhae has even seen it (the attribute covers a renamed layer).
 */
function koreanClass(site: SubtitleSite): string {
  return `dokhae-${site.id}-ko`;
}

interface Shown {
  key: string;
  lines: string[];
  text: string;
  cue: Cue;
}

export class VideoSubtitles {
  private settings: Settings | null = null;
  private active = false;
  private observer: MutationObserver | null = null;
  private frame = 0;
  private endTimer = 0;
  private lastKey = '';
  private shown: Shown | null = null;
  private history = new CueHistory();
  private watching: string | null = null;
  private jump: { cue: Cue; at: number } | null = null;
  private suppressAutoPauseUntil = 0;
  private pausedForPanel = false;
  private switchingPanel = false;
  private showTranslation = false;
  private hintShown = false;
  private lastTitle = '';
  private lines = new LineAnalyzer(askBackground);
  private readonly hintKey: string;
  private readonly translationKey: string;
  private hiddenRoot: Element | null = null;
  /** The player's subtitle layer, once found (see concernsSubtitles). */
  private subtitleRoot: Element | null = null;
  private overlay: Overlay | null = null;

  private readonly onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    if (changes[TOKEN_KEY] || changes[ACCESS_KEY]) {
      // Connected, subscribed or signed out meanwhile: ask again.
      this.lines.unlock();
    }
    if (changes[SETTINGS_KEY]) void this.loadSettings().then(() => this.sync());
  };

  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);
  private readonly onFullscreen = () => this.remount();
  /** The player can move under a fixed overlay (YouTube's page scrolls). */
  private readonly onViewport = () => {
    if (this.shown) this.overlay?.place(this.subtitleRoot);
  };

  constructor(readonly site: SubtitleSite) {
    this.hintKey = `${site.id}HintShown`;
    this.translationKey = `${site.id}Translation`;
  }

  async start() {
    await this.loadSettings();
    try {
      const stored = await chrome.storage.local.get(this.translationKey);
      this.showTranslation = stored[this.translationKey] === true;
    } catch {
      /* keep the default */
    }
    chrome.storage.onChanged.addListener(this.onStorage);
    this.sync();
  }

  stop() {
    this.deactivate();
    try {
      chrome.storage.onChanged.removeListener(this.onStorage);
    } catch {
      /* extension already gone */
    }
  }

  onLocation() {
    this.sync();
  }

  private async loadSettings() {
    try {
      this.settings = await getSettings();
    } catch {
      this.settings = null;
    }
  }

  /** Start or stop, depending on the page and the setting. */
  private sync() {
    const id = this.site.watchId(location);
    const wanted = Boolean(id && this.settings?.[this.site.enabledSetting]);
    if (id !== this.watching) {
      // Another title (or the next episode): its lines start from scratch.
      this.history.clear();
      this.jump = null;
      this.watching = id;
    }
    if (wanted && !this.active) this.activate();
    else if (!wanted && this.active) this.deactivate();
  }

  private activate() {
    this.active = true;
    this.overlay = new Overlay(this);
    this.observer = new MutationObserver((records) => {
      if (this.concernsSubtitles(records)) this.schedule();
    });
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('keydown', this.onKey, true);
    document.addEventListener('fullscreenchange', this.onFullscreen);
    window.addEventListener('scroll', this.onViewport, { passive: true });
    window.addEventListener('resize', this.onViewport, { passive: true });
    this.lastKey = '';
    this.schedule();
  }

  private deactivate() {
    this.active = false;
    this.observer?.disconnect();
    this.observer = null;
    // Reset too: a frame cancelled here but still counted would make
    // schedule() a no-op for good once the subtitles are switched back on.
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    clearTimeout(this.endTimer);
    this.subtitleRoot = null;
    // A line still waiting out its 300 ms must not be sent once the player is left.
    this.lines.leave();
    window.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    window.removeEventListener('scroll', this.onViewport);
    window.removeEventListener('resize', this.onViewport);
    this.overlay?.destroy();
    this.overlay = null;
    this.unhideNative();
    this.shown = null;
    this.lastKey = '';
  }

  /**
   * Whether a batch of mutations may have changed the subtitle on screen.
   * The player redraws its controls, clock and progress bar many times a
   * second; reading the subtitle layer (several selector scans of the whole
   * document) for each of those was most of this script's cost. Once the
   * layer is known, only changes inside it count, plus its removal or the
   * arrival of a new one.
   */
  private concernsSubtitles(records: MutationRecord[]): boolean {
    const root = this.subtitleRoot;
    if (!root || !root.isConnected) return true;
    for (const r of records) {
      if (root.contains(r.target)) return true;
      for (const node of r.addedNodes) {
        if (node instanceof Element && (node.contains(root) || this.site.mayBeSubtitleLayer(node))) {
          // A new layer may replace the known one: look it up again.
          this.subtitleRoot = null;
          return true;
        }
      }
    }
    return false;
  }

  /** Mutations come in bursts: read the subtitles once per frame at most. */
  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.check();
    });
  }

  private video(): HTMLVideoElement | null {
    return this.site.video(document);
  }

  /** Where Dokhae's layers go: the fullscreen element when there is one. */
  mount(): HTMLElement {
    const full = document.fullscreenElement;
    return full instanceof HTMLElement && full.tagName !== 'VIDEO' ? full : document.body;
  }

  private remount() {
    this.overlay?.attach(this.mount());
    const panel = openPanel();
    if (panel) this.mount().appendChild(panel.host);
  }

  private check() {
    if (!this.active) return;
    const title = this.site.readTitle(document);
    if (title) this.lastTitle = title;

    const root =
      this.subtitleRoot?.isConnected ? this.subtitleRoot : this.site.findSubtitleRoot(document);
    this.subtitleRoot = root;
    const lines = root ? this.site.readLines(root) : [];
    const key = lines.join('\n');
    if (key === this.lastKey) return;

    if (!lines.length) {
      // Wait a moment: the player sometimes clears a line and redraws it.
      this.lastKey = '';
      clearTimeout(this.endTimer);
      this.endTimer = window.setTimeout(() => {
        if (this.lastKey === '') this.endLine();
      }, LINE_END_DEBOUNCE_MS);
      return;
    }
    clearTimeout(this.endTimer);
    const text = subtitleText(lines);
    const previous = this.shown;
    // A line written word by word (YouTube's automatic captions) grows, or
    // scrolls up a row, without ending: no end-of-line pause, and the same cue.
    const continued = previous && previous.key !== key && continues(previous, lines, text) ? previous : null;
    if (previous && previous.key !== key) this.endLine(Boolean(continued));
    this.lastKey = key;

    if (!HANGUL_RE.test(text)) {
      // Not Korean: the player's own line stays.
      this.unhideNative();
      this.overlay?.hide();
      return;
    }
    if (this.shown?.key === key) return;

    const video = this.video();
    let cue: Cue;
    if (continued && text.startsWith(continued.text)) {
      cue = continued.cue;
      this.history.extend(cue, text);
    } else {
      cue = this.history.record(text, video?.currentTime ?? 0);
    }
    if (this.jump && (this.jump.cue === cue || performance.now() - this.jump.at > JUMP_ANCHOR_MS)) {
      this.jump = null;
    }
    this.shown = { key, lines, text, cue };
    if (root) this.hideNative(root);
    this.overlay?.attach(this.mount());
    this.overlay?.place(root);
    this.render();
    this.maybeShowHint();
    this.lines.show(
      text,
      () => {
        if (this.shown?.key === key) this.render();
      },
      root ? this.site.dwellMs?.(root) : undefined,
    );
  }

  /**
   * The line on screen just ended: auto-pause, then clear the overlay.
   * `continued` is a line that only grew or scrolled: no pause for it.
   */
  private endLine(continued = false) {
    const ended = this.shown;
    this.shown = null;
    this.lines.leave();
    this.overlay?.hide();
    if (!ended || continued) return;
    const video = this.video();
    if (
      this.settings?.[this.site.autoPauseSetting] &&
      video &&
      !video.paused &&
      !openPanel() &&
      performance.now() > this.suppressAutoPauseUntil
    ) {
      video.pause();
    }
  }

  private hideNative(root: Element) {
    if (this.hiddenRoot && this.hiddenRoot !== root) this.hiddenRoot.removeAttribute(HIDDEN_ATTR);
    root.setAttribute(HIDDEN_ATTR, '');
    this.hiddenRoot = root;
    document.documentElement.classList.add(koreanClass(this.site));
    this.overlay?.ensureNativeStyle();
  }

  private unhideNative() {
    this.hiddenRoot?.removeAttribute(HIDDEN_ATTR);
    this.hiddenRoot = null;
    document.documentElement.classList.remove(koreanClass(this.site));
    document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((el) => el.removeAttribute(HIDDEN_ATTR));
  }

  // -------------------------------------------------------------------------
  // Analysis: when to ask is src/video/lines.ts
  // -------------------------------------------------------------------------

  /** What the overlay shows for the current line, from what is known so far. */
  private render() {
    const shown = this.shown;
    if (!shown || !this.overlay) return;
    const analysis = this.lines.cached(shown.text);
    if (analysis) {
      this.overlay.showWords(shown, analysis, this.showTranslation);
      return;
    }
    const pending = this.lines.isPending(shown.text);
    const { locked, lastError } = this.lines;
    let note: OverlayNote | null = null;
    if (!pending && locked) {
      note = { text: locked.message, action: lockAction(locked.reason) };
    } else if (!pending && this.lines.backingOff()) {
      note = {
        text: 'Beaucoup de répliques analysées d’un coup. Dokhae reprend dans quelques minutes · clique la ligne pour l’analyser maintenant.',
        action: null,
      };
    } else if (!pending && lastError?.text === shown.text) {
      note = {
        text: `${lastError.message} · clique la ligne pour réessayer.`,
        action: lockAction(lastError.reason),
      };
    }
    this.overlay.showPlain(shown, note, pending);
  }

  /** A click on a line shown without analysis: ask for it now. */
  retryLine() {
    const shown = this.shown;
    if (!shown) return;
    const key = shown.key;
    const run = this.lines.analyse(shown.text, true);
    this.render();
    void run.then(() => {
      if (this.shown?.key === key) this.render();
    });
  }

  // -------------------------------------------------------------------------
  // A word clicked: pause, open the panel on it
  // -------------------------------------------------------------------------

  openWord(shown: Shown, analysis: AnalysisResult, index: number) {
    const video = this.video();
    if (video && !video.paused) {
      video.pause();
      this.pausedForPanel = true;
    }
    const id = this.watching;
    const at = shown.cue.start;
    this.switchingPanel = true;
    const panel = createPanel({
      mount: () => this.mount(),
      onClose: () => {
        if (this.switchingPanel) return;
        if (this.pausedForPanel) {
          this.pausedForPanel = false;
          void this.video()?.play().catch(() => {});
        }
      },
      cardSource: () => ({
        source: this.site.cardSourceLabel(this.site.readTitle(document) || this.lastTitle),
        sourceUrl: id ? this.site.watchUrl(id, at) : location.href,
      }),
    });
    this.switchingPanel = false;
    shieldFromPlayer(panel.host);
    // The example is the subtitle as shown, not the server's cleaned copy.
    renderResults(panel, { ...analysis, text: shown.text }, index);
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  private handleKey(e: KeyboardEvent) {
    if (!this.active || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (isEditable(e.target)) return;
    // Seen any Korean line yet? Otherwise these keys are not ours to take.
    if (!this.history.all().length) return;
    const key = e.key.toLowerCase();
    let handled = true;
    if (key === 'a') handled = this.jumpTo('previous');
    else if (key === 'r') handled = this.jumpTo('replay');
    else if (key === 't') this.toggleTranslation();
    else if (key === 'p') void this.toggleAutoPause();
    else handled = false;
    if (!handled) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private jumpTo(where: 'previous' | 'replay'): boolean {
    const video = this.video();
    if (!video) return false;
    const recent = this.jump && performance.now() - this.jump.at < JUMP_ANCHOR_MS ? this.jump.cue : null;
    const anchor = recent ?? this.shown?.cue ?? null;
    const now = video.currentTime;
    const target =
      where === 'previous' ? this.history.previous(now, anchor) : this.history.replay(now, anchor);
    if (!target) return false;
    if (openPanel()) closePanel(openPanel()!);
    this.jump = { cue: target, at: performance.now() };
    // The line being left must not trigger the end-of-line pause.
    this.suppressAutoPauseUntil = performance.now() + 1200;
    this.site.seek(video, Math.max(0, target.start - SEEK_LEAD));
    if (video.paused) void video.play().catch(() => {});
    return true;
  }

  private toggleTranslation() {
    this.showTranslation = !this.showTranslation;
    void chrome.storage.local.set({ [this.translationKey]: this.showTranslation }).catch(() => {});
    this.render();
    this.overlay?.toast(this.showTranslation ? 'Traduction affichée' : 'Traduction masquée');
  }

  private async toggleAutoPause() {
    try {
      const settings = await getSettings();
      const key = this.site.autoPauseSetting;
      const next = !settings[key];
      await saveSettings({ ...settings, [key]: next });
      this.settings = { ...settings, [key]: next };
      this.overlay?.toast(next ? 'Pause à la fin de chaque réplique' : 'Pause automatique coupée');
    } catch {
      // The extension was updated under the page: storage is gone with it.
      this.overlay?.toast('Dokhae a été mis à jour. Actualise la page.');
    }
  }

  private maybeShowHint() {
    if (this.hintShown) return;
    this.hintShown = true;
    void chrome.storage.local
      .get(this.hintKey)
      .then((stored) => {
        const count = Number(stored[this.hintKey] ?? 0);
        if (count >= HINT_SHOWS) return;
        void chrome.storage.local.set({ [this.hintKey]: count + 1 });
        this.overlay?.toast(this.site.hint, 7000);
      })
      .catch(() => {});
  }
}

/** One ANALYZE_TEXT round trip to the background, as an Outcome. */
async function askBackground(text: string, mode: AnalyzeMode): Promise<Outcome> {
  const resp = (await browser.runtime.sendMessage({
    type: 'ANALYZE_TEXT',
    text,
    mode,
  } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
  if (resp?.type === 'CAPTURE_RESULT') return { ok: true, analysis: resp.analysis };
  if (resp?.type === 'CAPTURE_ERROR') {
    return { ok: false, message: resp.message, reason: resp.reason, code: resp.code, retryAt: resp.retryAt };
  }
  return { ok: false, message: 'L’extension ne répond pas. Recharge la page et réessaie.' };
}

// ---------------------------------------------------------------------------
// The line drawn over the video
// ---------------------------------------------------------------------------

interface OverlayNote {
  text: string;
  action: { label: string; href: string } | null;
}

class Overlay {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private line: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private nativeStyle: HTMLStyleElement | null = null;

  constructor(private owner: VideoSubtitles) {
    this.host = document.createElement('div');
    this.host.id = `dokhae-${owner.site.id}-line`;
    Object.assign(this.host.style, {
      position: 'fixed', left: '0', right: '0', bottom: '10vh',
      zIndex: '2147483646', pointerEvents: 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
    });
    this.shadow = this.host.attachShadow({ mode: __SORI_SCREENSHOTS__ ? 'open' : 'closed' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_STYLES;
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    this.toastEl.setAttribute('role', 'status');
    this.line = document.createElement('div');
    this.line.className = 'line';
    this.line.setAttribute('lang', 'ko');
    this.shadow.append(style, this.toastEl, this.line);
    shieldFromPlayer(this.host);
    this.hide();
    this.attach(owner.mount());
  }

  attach(parent: HTMLElement) {
    if (this.host.parentElement !== parent) parent.appendChild(this.host);
  }

  /** The player's own layer is hidden by attribute, from a rule in the page. */
  ensureNativeStyle() {
    if (this.nativeStyle?.isConnected) return;
    this.nativeStyle = document.createElement('style');
    const { site } = this.owner;
    this.nativeStyle.textContent =
      `[${HIDDEN_ATTR}], html.${koreanClass(site)} ${site.nativeSelector} { visibility: hidden !important; }`;
    (document.head ?? document.documentElement).appendChild(this.nativeStyle);
  }

  /**
   * Sit where the player draws its line, so it moves up with the controls,
   * centred on the player when it does not fill the window. Out of sight
   * when the player has scrolled out of view.
   */
  place(root: Element | null) {
    const { site } = this.owner;
    const viewH = window.innerHeight;
    const box = document.fullscreenElement ? null : site.playerBox(document)?.getBoundingClientRect();
    const frameBottom = box && box.height > 0 ? Math.min(viewH, box.bottom) : viewH;
    let bottom = viewH - frameBottom + (box ? box.height : viewH) * 0.1;
    const block = root ? site.textBlock(root) : null;
    const rect = block?.getBoundingClientRect();
    if (rect && rect.height > 0 && rect.bottom > 0 && rect.bottom <= viewH) bottom = viewH - rect.bottom;
    this.host.style.bottom = `${Math.round(Math.max(viewH * 0.03, bottom))}px`;
    if (box && box.width > 0) {
      this.host.style.left = `${Math.round(box.left)}px`;
      this.host.style.right = `${Math.round(window.innerWidth - box.right)}px`;
    } else {
      this.host.style.left = '0';
      this.host.style.right = '0';
    }
    const offscreen = Boolean(box && (box.bottom <= 0 || box.top >= viewH));
    this.host.style.visibility = offscreen ? 'hidden' : '';
  }

  hide() {
    this.line.hidden = true;
    this.line.replaceChildren();
  }

  showPlain(shown: Shown, note: OverlayNote | null, pending: boolean) {
    this.line.hidden = false;
    this.line.className = `line plain${pending ? ' pending' : ''}`;
    this.line.replaceChildren();
    const text = document.createElement('button');
    text.type = 'button';
    text.className = 'plain-text';
    text.textContent = shown.lines.join('\n');
    text.title = pending ? 'Analyse en cours…' : 'Analyser cette réplique';
    text.disabled = pending;
    text.addEventListener('click', () => this.owner.retryLine());
    this.line.appendChild(text);
    if (note) {
      const n = document.createElement('div');
      n.className = 'note';
      n.lang = 'fr';
      n.innerHTML = `${esc(note.text)}${note.action ? ` <a href="${esc(note.action.href)}" target="_blank" rel="noreferrer">${esc(note.action.label)}</a>` : ''}`;
      this.line.appendChild(n);
    }
  }

  showWords(shown: Shown, analysis: AnalysisResult, withTranslation: boolean) {
    this.line.hidden = false;
    this.line.className = 'line';
    this.line.replaceChildren();
    const words = document.createElement('div');
    words.className = 'words';
    // Walk the lines as shown (with their breaks, dashes and punctuation),
    // locating each analysed word in order.
    phraseParts(shown.lines.join('\n'), analysis.words.map((w) => w.surface)).forEach((part) => {
      if (part.kind === 'gap') {
        words.appendChild(document.createTextNode(part.text));
        return;
      }
      const info = analysis.words[part.index]!;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'w';
      b.textContent = info.surface;
      b.title = [posLabel(info.pos), info.translation].filter(Boolean).join(' · ');
      b.style.setProperty('--c', onDark(posColor(info.pos)));
      b.addEventListener('click', () => this.owner.openWord(shown, analysis, part.index));
      words.appendChild(b);
    });
    this.line.appendChild(words);
    if (withTranslation) {
      const tr = document.createElement('div');
      tr.className = 'tr';
      tr.lang = 'fr';
      tr.textContent = analysis.sentenceTranslation || 'Traduction indisponible';
      this.line.appendChild(tr);
    }
  }

  toast(message: string, ms = 1800) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }

  destroy() {
    clearTimeout(this.toastTimer);
    this.host.remove();
    this.nativeStyle?.remove();
  }
}

/**
 * Keep the player from reacting to what happens on Dokhae's layers: a click
 * on a word would otherwise also toggle playback, and a key pressed on one of
 * our buttons would reach the player's shortcuts.
 */
function shieldFromPlayer(host: Element) {
  for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'wheel']) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** A part-of-speech colour lifted toward white, readable on the dark line. */
function onDark(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lift = (c: number) => Math.round(c + (255 - c) * 0.45);
  return `rgb(${lift((n >> 16) & 255)}, ${lift((n >> 8) & 255)}, ${lift(n & 255)})`;
}

const OVERLAY_STYLES = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  .line {
    pointer-events: auto;
    max-width: min(92vw, 1400px);
    padding: 0.2em 0.55em 0.3em;
    background: rgba(22, 20, 26, 0.78);
    border-radius: 12px;
    color: #ffffff;
    font-family: ${FONT_STACK};
    font-size: clamp(18px, 3.6vh, 48px);
    font-weight: 600;
    line-height: 1.55;
    text-align: center;
    -webkit-font-smoothing: antialiased;
  }
  .line[hidden] { display: none; }
  .words { white-space: pre-line; word-break: keep-all; }
  .w {
    font: inherit; color: inherit; background: none; border: 0; margin: 0;
    padding: 0 0.06em; border-radius: 6px; cursor: pointer;
    text-decoration: underline solid 0.08em;
    text-decoration-color: var(--c, rgba(255, 255, 255, 0.5));
    text-underline-offset: 0.2em;
    transition: background-color 0.12s ease;
  }
  .w:hover, .w:focus-visible { background: rgba(255, 255, 255, 0.16); outline: none; }
  .plain-text {
    font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0;
    white-space: pre-line; word-break: keep-all; cursor: pointer;
  }
  .plain-text:disabled { cursor: progress; }
  .pending .plain-text { opacity: 0.85; }
  .tr {
    margin-top: 0.15em;
    font-size: 0.62em; font-weight: 500; line-height: 1.4;
    color: #e8e4da;
  }
  .note {
    margin-top: 0.3em;
    font-size: max(13px, 0.42em); font-weight: 500; line-height: 1.4;
    color: #f4f1e9;
  }
  .note a { color: #b7c3f6; font-weight: 700; text-underline-offset: 2px; }
  .toast {
    pointer-events: none;
    max-width: min(92vw, 900px);
    padding: 8px 14px;
    background: #16141a; color: #f4f1e9;
    border: 1px solid #000000; border-radius: 12px;
    font-family: ${FONT_STACK}; font-size: 14px; font-weight: 600; line-height: 1.4;
    text-align: center;
    opacity: 0; transition: opacity 0.2s ease;
  }
  .toast.on { opacity: 1; }
  @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
`;
