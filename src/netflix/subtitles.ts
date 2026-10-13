/*
 * Reading Netflix's subtitles from the page, as the player draws them.
 *
 * Only the text already on screen is read: no subtitle file, no video. The
 * player renders each cue as positioned spans, today:
 *
 *   <div class="player-timedtext">
 *     <div class="player-timedtext-text-container" style="...">
 *       <span><span>첫 줄</span><br><span>둘째 줄</span></span>
 *     </div>
 *   </div>
 *
 * Netflix renames its classes now and then, so every selector lives here,
 * behind small functions the tests feed with representative fragments. When
 * the player changes, this file is the one to fix.
 */

/** The whole subtitle layer, most specific first. */
const ROOT_SELECTORS = ['.player-timedtext', '[data-uia="player-timedtext"]', '[class*="timedtext" i]'];

/** One positioned block of text inside the layer (a cue can have several). */
const BLOCK_SELECTORS = ['.player-timedtext-text-container', '[class*="text-container" i]'];

/** Elements that end a line of text like a <br> does. */
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'SECTION']);

/** The subtitle layer in this document, or null while the player has none. */
export function findSubtitleRoot(doc: ParentNode): Element | null {
  for (const selector of ROOT_SELECTORS) {
    // The loose pattern also matches the layer's own children
    // (player-timedtext-text-container): keep the outermost one.
    const outer = outermost([...doc.querySelectorAll(selector)])[0];
    if (outer) return outer;
  }
  return null;
}

/**
 * The lines of the cue on screen, in reading order, whitespace tidied and
 * empty lines dropped. Separate blocks (one at the top, one at the bottom)
 * and <br> both start a new line. Hidden blocks are left out.
 */
export function readSubtitleLines(root: Element): string[] {
  let blocks: Element[] = [];
  for (const selector of BLOCK_SELECTORS) {
    blocks = outermost([...root.querySelectorAll(selector)]).filter((el) => !isHidden(el));
    if (blocks.length) break;
  }
  if (!blocks.length) blocks = isHidden(root) ? [] : [root];

  let raw = '';
  for (const block of blocks) {
    raw += '\n' + textWithBreaks(block) + '\n';
  }
  return raw
    .split('\n')
    .map((line) => line.replace(/[\s ​]+/g, ' ').trim())
    .filter(Boolean);
}

/** One string for the API and the card: the lines joined by a space. */
export function subtitleText(lines: string[]): string {
  return lines.join(' ');
}

/** The elements of a match list that no other one contains, in document order. */
function outermost(found: Element[]): Element[] {
  return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
}

function textWithBreaks(node: Node): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      out += child.textContent ?? '';
    } else if (child.nodeType === 1) {
      const el = child as Element;
      if (el.tagName === 'BR') out += '\n';
      else if (isHidden(el)) return;
      else if (BLOCK_TAGS.has(el.tagName)) out += '\n' + textWithBreaks(el) + '\n';
      else out += textWithBreaks(el);
    }
  });
  return out;
}

/** Hidden through its inline style: the player hides blocks that way, never through classes. */
function isHidden(el: Element): boolean {
  const style = (el.getAttribute('style') ?? '').replace(/\s+/g, '').toLowerCase();
  return /(^|;)display:none/.test(style) || /(^|;)visibility:hidden/.test(style);
}

/**
 * What the player shows as the title: "Série · É3 · Titre de l'épisode", or
 * the film's name. Read from the title block of the controls, then from the
 * tab's title. Empty when neither says anything useful.
 */
export function readEpisodeTitle(doc: Document): string {
  const block = doc.querySelector('[data-uia="video-title"]');
  if (block) {
    const parts = [...block.children]
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const title = parts.length ? parts.join(' · ') : (block.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (title) return title.slice(0, 120);
  }
  const fromTab = doc.title.replace(/\s*[|·-]\s*Netflix\s*$/i, '').trim();
  return fromTab && !/^netflix$/i.test(fromTab) ? fromTab.slice(0, 120) : '';
}

/** The title id in /watch/81234567, or null away from the player. */
export function watchId(pathname: string): string | null {
  return /^\/watch\/(\d+)/.exec(pathname)?.[1] ?? null;
}

/** The card's link back: the same title, at the moment the word was heard. */
export function watchUrl(id: string, seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `https://www.netflix.com/watch/${id}${t ? `?t=${t}` : ''}`;
}

/** The card's source label: "Netflix", plus the title when the page shows it. */
export function cardSourceLabel(title: string): string {
  return title ? `Netflix · ${title}` : 'Netflix';
}
