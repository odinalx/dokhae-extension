import type { SubtitleSite } from '../video/site';
import { mainVideo, queryDeep, readLinesIn, tabTitle } from '../video/dom';
import { requestSeek } from './bridge';

/*
 * Disney+ (disneyplus.com), for the shared subtitle player
 * (src/video/player.ts). Its player has drawn the subtitles under several
 * names over the years, and draws them inside its web components' shadow
 * roots in some versions:
 *
 *   <div class="TimedTextOverlay">
 *     <div class="hive-subtitle-renderer-wrapper"> … <div class="hive-subtitle-renderer-cue-window">
 *       <span class="hive-subtitle-renderer-line">첫 줄</span>
 *       <span class="hive-subtitle-renderer-line">둘째 줄</span>
 *
 * (".dss-…" before "hive", and a Shaka text container outside the US). All
 * are tried, in the document and in open shadow roots; the mutations inside
 * a shadow root never reach the page's observer, so the site is also polled
 * (`pollMs`). Every selector lives here.
 */

const ROOT_SELECTORS = [
  '.TimedTextOverlay',
  '.hive-subtitle-renderer-wrapper',
  '.dss-subtitle-renderer-wrapper',
  'timed-text-override-region',
  '.shaka-text-container',
];
const LINE_SELECTOR = '.hive-subtitle-renderer-line, .dss-subtitle-renderer-line';

export const findSubtitleRoot = (doc: ParentNode) => queryDeep(doc, ROOT_SELECTORS, true);
export const readSubtitleLines = (root: Element) => readLinesIn(root, LINE_SELECTOR);

/** The title being played on /play/<id> or /video/<id> (with or without a locale), or null. */
export function watchId(pathname: string): string | null {
  const m = /\/(play|video)\/([\w-]{6,})/.exec(pathname);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The card's link back: the same title (Disney+ has no time parameter). */
export const watchUrl = (id: string) => `https://www.disneyplus.com/${id}`;

export const cardSourceLabel = (title: string) => (title ? `Disney+ · ${title}` : 'Disney+');

export const readTitle = (doc: Document) => {
  const t = tabTitle(doc, /\s*[|-]\s*Disney\+\s*$/i);
  return /^disney\+?$/i.test(t) ? '' : t;
};

export const disneySite: SubtitleSite = {
  id: 'disney',
  enabledSetting: 'disneySubtitles',
  autoPauseSetting: 'disneyAutoPause',
  watchId: (loc) => watchId(loc.pathname),
  findSubtitleRoot,
  readLines: readSubtitleLines,
  mayBeSubtitleLayer: (el) =>
    /timedtext|subtitle-renderer|shaka-text/i.test(el.className?.toString() ?? '') ||
    /^(disney-web-player|timed-text-override-region)$/i.test(el.tagName),
  nativeSelector: ROOT_SELECTORS.join(', '),
  textBlock: (root) =>
    root.querySelector('[class*="cue-window"], [class*="positioning-box"]') ?? root.firstElementChild ?? root,
  // The player fills the window.
  playerBox: () => null,
  readTitle,
  watchUrl,
  cardSourceLabel,
  // Disney+ mounts several <video> (bumpers, previews): the one playing.
  video: (doc) => mainVideo([...doc.querySelectorAll('video')]),
  // Its player keeps its own clock: go through its API, like Netflix.
  seek: (_video, seconds) => requestSeek(seconds),
  pollMs: 300,
  hint: 'Dokhae · clique un mot · A réplique précédente · R rejouer · T traduction · P pause auto',
};
