import { SEEK_EVENT } from '../src/disney/bridge';

/*
 * Disney+'s player keeps its own playhead, which the <video>'s currentTime
 * does not drive: seeking goes through the player element's API
 * (`mediaPlayer.seek`, in milliseconds, as Firefox's picture-in-picture does
 * it), which only the page's own JavaScript can reach. This tiny script runs
 * in the page's world for that one job; the Disney+ subtitle script sends it
 * a target time on the <video>'s clock, as a string in a DOM event.
 *
 * Anything the page can already do itself, so listening to its events gives
 * the page nothing new.
 */
export default defineContentScript({
  matches: ['https://www.disneyplus.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    document.addEventListener(SEEK_EVENT, (event) => {
      const to = Number((event as CustomEvent<unknown>).detail);
      if (!Number.isFinite(to) || to < 0) return;
      const host = document.querySelector('disney-web-player') as DisneyPlayerElement | null;
      const video = host?.querySelector('video') ?? document.querySelector('video');
      try {
        const player = host?.mediaPlayer;
        const at = player?.heartbeat?.playheadPosition;
        if (player?.seek && typeof at === 'number' && video) {
          // Move the player's playhead by the distance the <video> clock has to travel.
          player.seek(Math.max(0, at + (to - video.currentTime) * 1000));
          return;
        }
      } catch {
        // Disney+ moved its API: fall through to the plain way.
      }
      if (video) video.currentTime = to;
    });
  },
});

interface DisneyPlayerElement extends HTMLElement {
  mediaPlayer?: {
    seek?: (ms: number) => void;
    heartbeat?: { playheadPosition?: number };
  };
}
