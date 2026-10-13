import { SEEK_EVENT } from '../src/netflix/bridge';

/*
 * Netflix's player breaks (error M7375) when a script moves the <video>'s
 * currentTime itself: it has to be asked through its own API, which lives in
 * the page's JavaScript, out of reach of a normal content script. This tiny
 * script runs in the page's world for that one job. The Netflix subtitle
 * script (netflix.content.ts) sends it a target time, on the <video>'s clock,
 * as a string in a DOM event; nothing else crosses over.
 *
 * Anything the page can already do itself, so listening to its events gives
 * the page nothing new.
 */
export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    document.addEventListener(SEEK_EVENT, (event) => {
      const to = Number((event as CustomEvent<unknown>).detail);
      if (!Number.isFinite(to) || to < 0) return;
      const video = document.querySelector('video');
      if (!video) return;
      try {
        const api = (window as unknown as NetflixWindow).netflix?.appContext?.state?.playerApp?.getAPI?.()
          ?.videoPlayer;
        const ids = api?.getAllPlayerSessionIds?.() ?? [];
        // The session of the title being watched ("watch-…"), else the last one.
        const id = ids.find((s) => s.startsWith('watch')) ?? ids[ids.length - 1];
        const player = id ? api?.getVideoPlayerBySessionId?.(id) : undefined;
        if (player?.seek && player.getCurrentTime) {
          // The player counts in milliseconds on its own clock; move it by the
          // same distance the <video> clock has to travel.
          player.seek(Math.max(0, player.getCurrentTime() + (to - video.currentTime) * 1000));
          return;
        }
      } catch {
        // Netflix moved its API: fall through to the plain way.
      }
      video.currentTime = to;
    });
  },
});

interface NetflixPlayer {
  seek?: (ms: number) => void;
  getCurrentTime?: () => number;
}

interface NetflixWindow {
  netflix?: {
    appContext?: {
      state?: {
        playerApp?: {
          getAPI?: () => {
            videoPlayer?: {
              getAllPlayerSessionIds?: () => string[];
              getVideoPlayerBySessionId?: (id: string) => NetflixPlayer | undefined;
            };
          };
        };
      };
    };
  };
}
