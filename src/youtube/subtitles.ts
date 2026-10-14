/*
 * Reading YouTube's captions from the page, as the player draws them.
 *
 * Like Netflix, only the text already on screen is read: no caption file
 * (YouTube's timedtext requests now need a token only its own player has).
 * The player renders each caption window as:
 *
 *   <div class="ytp-caption-window-container" id="ytp-caption-window-container">
 *     <div class="caption-window ytp-caption-window-bottom" id="caption-window-1">
 *       <span class="captions-text">
 *         <span class="caption-visual-line"><span class="ytp-caption-segment">첫 줄</span></span>
 *         <span class="caption-visual-line"><span class="ytp-caption-segment">둘째 줄</span></span>
 *       </span>
 *     </div>
 *   </div>
 *
 * Automatic captions (speech recognition) add "ytp-caption-window-rollup" to
 * the window and write each line word by word, scrolling up a row at a time.
 * Every selector lives here; when the player changes, this file is the one
 * to fix.
 */

const ROOT_SELECTORS = ['#ytp-caption-window-container', '.ytp-caption-window-container'];
const WINDOW_SELECTOR = '.caption-window';
const LINE_SELECTOR = '.caption-visual-line';
const SEGMENT_SELECTOR = '.ytp-caption-segment';
const ROLLUP_CLASS = 'ytp-caption-window-rollup';

/** The caption layer in this document, or null while the player has none. */
export function findSubtitleRoot(doc: ParentNode): Element | null {
  for (const selector of ROOT_SELECTORS) {
    const found = doc.querySelector(selector);
    if (found) return found;
  }
  return null;
}

/**
 * The lines on screen, in reading order, whitespace tidied and empty lines
 * dropped. Each visual line is one line; its segments (one per word in
 * automatic captions) join into it. Hidden windows are left out.
 */
export function readSubtitleLines(root: Element): string[] {
  const out: string[] = [];
  for (const win of root.querySelectorAll(WINDOW_SELECTOR)) {
    if (isHidden(win)) continue;
    const rows = [...win.querySelectorAll(LINE_SELECTOR)];
    const parts = rows.length ? rows : [win];
    for (const row of parts) {
      if (isHidden(row)) continue;
      const segments = [...row.querySelectorAll(SEGMENT_SELECTOR)];
      const text = segments.length
        ? segments.map((s) => s.textContent ?? '').join('')
        : (row.textContent ?? '');
      for (const line of text.split('\n')) {
        const tidy = line.replace(/[\s\u200b]+/g, ' ').trim();
        if (tidy) out.push(tidy);
      }
    }
  }
  return out;
}

/** Whether the captions on screen are automatic ones, written word by word. */
export function isRolling(root: Element): boolean {
  return Boolean(root.querySelector(`.${ROLLUP_CLASS}`));
}

/** The window the overlay sits on: the bottom one, else the last one shown. */
export function captionBlock(root: Element): Element | null {
  const windows = [...root.querySelectorAll(WINDOW_SELECTOR)].filter((w) => !isHidden(w));
  return windows.find((w) => w.classList.contains('ytp-caption-window-bottom')) ?? windows.pop() ?? null;
}

function isHidden(el: Element): boolean {
  const style = (el.getAttribute('style') ?? '').replace(/\s+/g, '').toLowerCase();
  return /(^|;)display:none/.test(style) || /(^|;)visibility:hidden/.test(style);
}

/**
 * The video's title: the heading under the player, else the tab's title
 * (without its "(3) " notification count and " - YouTube"). Empty when
 * neither says anything useful.
 */
export function readVideoTitle(doc: Document): string {
  const heading = doc.querySelector('ytd-watch-metadata h1, h1.ytd-watch-metadata, #title h1');
  const fromHeading = (heading?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (fromHeading) return fromHeading.slice(0, 120);
  const fromTab = doc.title
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/\s*-\s*YouTube\s*$/i, '')
    .trim();
  return fromTab && !/^youtube$/i.test(fromTab) ? fromTab.slice(0, 120) : '';
}

/** The video id on /watch?v=… and /live/…, or null away from a video. */
export function watchId(pathname: string, search: string): string | null {
  const valid = (id: string | null | undefined) => (id && /^[\w-]{6,20}$/.test(id) ? id : null);
  if (pathname === '/watch') return valid(new URLSearchParams(search).get('v'));
  return valid(/^\/live\/([^/?#]+)/.exec(pathname)?.[1]);
}

/** The card's link back: the same video, at the moment the word was heard. */
export function watchUrl(id: string, seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `https://www.youtube.com/watch?v=${id}${t ? `&t=${t}s` : ''}`;
}

/** The card's source label: "YouTube", plus the title when the page shows it. */
export function cardSourceLabel(title: string): string {
  return title ? `YouTube · ${title}` : 'YouTube';
}
