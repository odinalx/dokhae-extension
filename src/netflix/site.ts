import type { SubtitleSite } from '../video/site';
import { requestSeek } from './bridge';
import {
  cardSourceLabel,
  findSubtitleRoot,
  readEpisodeTitle,
  readSubtitleLines,
  watchId,
  watchUrl,
} from './subtitles';

/** Netflix, for the shared subtitle player (src/video/player.ts). */
export const netflixSite: SubtitleSite = {
  id: 'netflix',
  enabledSetting: 'netflixSubtitles',
  autoPauseSetting: 'netflixAutoPause',
  watchId: (loc) => watchId(loc.pathname),
  findSubtitleRoot,
  readLines: readSubtitleLines,
  mayBeSubtitleLayer: (el) => /timedtext/i.test(el.className?.toString() ?? ''),
  nativeSelector: '.player-timedtext',
  textBlock: (root) => root.querySelector('.player-timedtext-text-container') ?? root.firstElementChild,
  // The player always fills the window.
  playerBox: () => null,
  readTitle: readEpisodeTitle,
  watchUrl,
  cardSourceLabel,
  video: (doc) => doc.querySelector('video'),
  // Moving currentTime crashes Netflix's player (M7375): go through its API.
  seek: (_video, seconds) => requestSeek(seconds),
  hint: 'Dokhae · clique un mot · A réplique précédente · R rejouer · T traduction · P pause auto',
};
