import type { SubtitleSite } from '../video/site';
import { mainVideo, queryDeep, readLinesIn, tabTitle } from '../video/dom';

/*
 * Prime Video (primevideo.com, and the video pages of amazon.fr and
 * amazon.com), for the shared subtitle player (src/video/player.ts). Its web
 * player draws the captions as
 *
 *   <div class="atvwebplayersdk-captions-overlay">
 *     <div …><span class="atvwebplayersdk-captions-text">첫 줄</span></div>
 *   </div>
 *
 * (the class Firefox's picture-in-picture reads on Prime Video). Every
 * selector lives here; when the player changes, this file is the one to fix.
 */

const ROOT_SELECTORS = ['.atvwebplayersdk-captions-overlay', '[class*="captions-overlay" i]'];
const TEXT_SELECTOR = '.atvwebplayersdk-captions-text';

export const findSubtitleRoot = (doc: ParentNode) => queryDeep(doc, ROOT_SELECTORS);
export const readSubtitleLines = (root: Element) => readLinesIn(root, TEXT_SELECTOR);

/**
 * The title's id (an ASIN or a Prime Video id) when the address names one.
 * The player opens over whatever page started it (the home page included)
 * without changing the address, so away from a detail page the script still
 * runs, as "prime", and only works once a caption layer shows up.
 */
export function watchId(pathname: string): string {
  return /\/(?:detail|dp)\/([\w.-]{6,})/.exec(pathname)?.[1] ?? 'prime';
}

/** The card's link back: the title's page (Prime Video has no time parameter). */
export function watchUrl(id: string, origin: string): string {
  if (id === 'prime') return origin;
  return origin.includes('primevideo.com') ? `${origin}/detail/${id}` : `${origin}/gp/video/detail/${id}`;
}

export const cardSourceLabel = (title: string) => (title ? `Prime Video · ${title}` : 'Prime Video');

/** "Série · S1 É3 Titre" from the player's title block, else the tab's title. */
export function readTitle(doc: Document): string {
  const part = (sel: string) => (doc.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const shown = [part('.atvwebplayersdk-title-text'), part('.atvwebplayersdk-subtitle-text')].filter(Boolean).join(' · ');
  if (shown) return shown.slice(0, 120);
  const tab = tabTitle(doc, /^\s*(Prime Video|Amazon\.\w+(\.\w+)?)\s*:\s*/i).replace(/\s*[|:-]\s*Prime Video\s*$/i, '');
  return /^(prime video|amazon)/i.test(tab) ? '' : tab;
}

export const primeSite: SubtitleSite = {
  id: 'prime',
  enabledSetting: 'primeSubtitles',
  autoPauseSetting: 'primeAutoPause',
  watchId: (loc) => watchId(loc.pathname),
  findSubtitleRoot,
  readLines: readSubtitleLines,
  mayBeSubtitleLayer: (el) => /captions/i.test(el.className?.toString() ?? '') || el.id === 'dv-web-player',
  nativeSelector: '.atvwebplayersdk-captions-overlay',
  textBlock: (root) => root.querySelector(TEXT_SELECTOR)?.parentElement ?? root,
  // The player covers the page it opened over.
  playerBox: (doc) => doc.querySelector('#dv-web-player'),
  readTitle,
  watchUrl: (id) => watchUrl(id, location.origin),
  cardSourceLabel,
  video: (doc) =>
    mainVideo([...doc.querySelectorAll<HTMLVideoElement>('#dv-web-player video, .webPlayerSDKContainer video')]) ??
    mainVideo([...doc.querySelectorAll('video')]),
  // The player follows its <video> when currentTime moves (Firefox's
  // picture-in-picture seeks Prime Video the same way).
  seek: (video, seconds) => { video.currentTime = seconds; },
  hint: 'Dokhae · clique un mot · A réplique précédente · R rejouer · T traduction · P pause auto',
};
