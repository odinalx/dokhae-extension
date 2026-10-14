import type { SubtitleSite } from '../video/site';
import {
  captionBlock,
  cardSourceLabel,
  findSubtitleRoot,
  isRolling,
  readSubtitleLines,
  readVideoTitle,
  watchId,
  watchUrl,
} from './subtitles';

/** YouTube, for the shared subtitle player (src/video/player.ts). */
export const youtubeSite: SubtitleSite = {
  id: 'youtube',
  enabledSetting: 'youtubeSubtitles',
  autoPauseSetting: 'youtubeAutoPause',
  watchId: (loc) => watchId(loc.pathname, loc.search),
  findSubtitleRoot,
  readLines: readSubtitleLines,
  mayBeSubtitleLayer: (el) => /caption-window/i.test(el.className?.toString() ?? '') || el.id === 'ytp-caption-window-container',
  nativeSelector: '.ytp-caption-window-container',
  textBlock: captionBlock,
  // Outside fullscreen the player is a box in the page, which scrolls.
  playerBox: (doc) => doc.querySelector('#movie_player, .html5-video-player'),
  readTitle: readVideoTitle,
  watchUrl,
  cardSourceLabel,
  video: (doc) =>
    doc.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video, #movie_player video') ??
    doc.querySelector('video'),
  // YouTube's player follows its <video> when currentTime moves.
  seek: (video, seconds) => {
    video.currentTime = seconds;
  },
  // Automatic captions write a line word by word.
  isRolling,
  hint: 'Dokhae · clique un mot · A réplique précédente · R rejouer · T traduction (au lieu du mode cinéma) · P pause auto',
};
