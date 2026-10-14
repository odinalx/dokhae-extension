/*
 * Reading a player's subtitle layer, for the sites whose players are alike
 * enough to share it (Viki, Disney+, Prime Video): a layer found by one of a
 * few selectors, sometimes inside an open shadow root, whose text breaks into
 * lines at <br> and at block elements.
 */

/** Elements that end a line of text like a <br> does. */
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'SECTION']);

/**
 * The first element matching one of `selectors`, most specific first. With
 * `deep`, open shadow roots are searched too (Disney+ draws its player in web
 * components); that walks every element, so only the site that needs it asks.
 * The outermost match wins, so a loose selector that also matches the
 * layer's children still gives the layer.
 */
export function queryDeep(root: ParentNode, selectors: readonly string[], deep = false): Element | null {
  for (const selector of selectors) {
    const found = outermost([...root.querySelectorAll(selector)])[0];
    if (found) return found;
  }
  if (!deep) return null;
  for (const host of shadowHosts(root)) {
    const found = queryDeep(host.shadowRoot!, selectors, true);
    if (found) return found;
  }
  return null;
}

function shadowHosts(root: ParentNode): Element[] {
  const hosts: Element[] = [];
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) hosts.push(el);
  return hosts;
}

/** The elements of a match list that no other one contains, in document order. */
export function outermost(found: Element[]): Element[] {
  return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
}

/**
 * The lines in `blocks` (or in `root` when no block matches), in reading
 * order, whitespace tidied and empty lines dropped. Each block, each <br>
 * and each block element starts a new line. Hidden elements are left out.
 */
export function readLinesIn(root: Element, blockSelector?: string): string[] {
  const blocks = blockSelector
    ? outermost([...root.querySelectorAll(blockSelector)]).filter((el) => !isHidden(el))
    : [];
  const sources = blocks.length ? blocks : isHidden(root) ? [] : [root];
  let raw = '';
  for (const block of sources) raw += '\n' + textWithBreaks(block) + '\n';
  return raw
    .split('\n')
    .map((line) => line.replace(/[\s​]+/g, ' ').trim())
    .filter(Boolean);
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

/** Hidden through its inline style, the way players hide a cue. */
export function isHidden(el: Element): boolean {
  const style = (el.getAttribute('style') ?? '').replace(/\s+/g, '').toLowerCase();
  return /(^|;)display:none/.test(style) || /(^|;)visibility:hidden/.test(style);
}

/**
 * The <video> being watched when a page holds several (trailers, bumpers,
 * a preview behind the player): the visible one with a source that plays.
 */
export function mainVideo(videos: readonly HTMLVideoElement[]): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestScore = -Infinity;
  for (const video of videos) {
    let score = 0;
    const rect = video.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) score += 100 + Math.min((rect.width * rect.height) / 20000, 50);
    if (video.readyState >= 2) score += 40;
    if (video.currentSrc || video.getAttribute('src')) score += 25;
    if (!video.paused && !video.ended) score += 30;
    if (video.currentTime > 0) score += 15;
    if (score > bestScore) {
      bestScore = score;
      best = video;
    }
  }
  return best;
}

/** The tab's title without the site's name: "Titre | Rakuten Viki" → "Titre". */
export function tabTitle(doc: Document, brand: RegExp): string {
  const t = doc.title.replace(brand, '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 120);
}
