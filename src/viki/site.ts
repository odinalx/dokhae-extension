import type { SubtitleSite } from '../video/site';
import { mainVideo, queryDeep, readLinesIn, tabTitle } from '../video/dom';

/*
 * Viki (viki.com), for the shared subtitle player (src/video/player.ts).
 * Its player is video.js, which draws the active cues as
 *
 *   <div class="vjs-text-track-display">
 *     <div class="vjs-text-track-cue"><div>첫 줄<br>둘째 줄</div></div>
 *   </div>
 *
 * (the same layer Firefox's picture-in-picture reads on Viki). Every
 * selector lives here; when the player changes, this file is the one to fix.
 */

const ROOT_SELECTORS = ['.vjs-text-track-display'];
const CUE_SELECTOR = '.vjs-text-track-cue';

export const findSubtitleRoot = (doc: ParentNode) => queryDeep(doc, ROOT_SELECTORS);
export const readSubtitleLines = (root: Element) => readLinesIn(root, CUE_SELECTOR);

/** The episode on /videos/<id>-<slug>, or null away from one. */
export function watchId(pathname: string): string | null {
  return /^\/videos\/(\d+v)\b/.exec(pathname)?.[1] ?? null;
}

/** The card's link back. Viki has no time parameter: the episode. */
export const watchUrl = (id: string) => `https://www.viki.com/videos/${id}`;

export const cardSourceLabel = (title: string) => (title ? `Viki · ${title}` : 'Viki');

/** "What's Wrong With Secretary Kim - Episode 1 | Rakuten Viki" → the part before the brand. */
export const readTitle = (doc: Document) => tabTitle(doc, /\s*\|\s*(Rakuten\s+)?Viki\s*$/i);

export const vikiSite: SubtitleSite = {
  id: 'viki',
  enabledSetting: 'vikiSubtitles',
  autoPauseSetting: 'vikiAutoPause',
  watchId: (loc) => watchId(loc.pathname),
  findSubtitleRoot,
  readLines: readSubtitleLines,
  mayBeSubtitleLayer: (el) => /text-track/i.test(el.className?.toString() ?? ''),
  nativeSelector: '.vjs-text-track-display',
  textBlock: (root) => root.querySelector(CUE_SELECTOR) ?? root,
  // The player is a box in the page outside fullscreen.
  playerBox: (doc) => doc.querySelector('.video-js'),
  readTitle,
  watchUrl,
  cardSourceLabel,
  video: (doc) => doc.querySelector<HTMLVideoElement>('.video-js video.vjs-tech') ?? mainVideo([...doc.querySelectorAll('video')]),
  // video.js follows its <video> when currentTime moves.
  seek: (video, seconds) => { video.currentTime = seconds; },
  hint: 'Dokhae · clique un mot · A réplique précédente · R rejouer · T traduction · P pause auto',
};
