import { primeSite } from '../src/prime/site';
import { VideoSubtitles } from '../src/video/player';

/*
 * Prime Video's Korean subtitles, redrawn by Dokhae (src/video/player.ts,
 * with what is specific to Prime Video in src/prime/). On amazon.fr and
 * amazon.com only the video pages are matched (/gp/video/), not the shop.
 */
export default defineContentScript({
  matches: [
    'https://www.primevideo.com/*',
    'https://www.amazon.fr/gp/video/*',
    'https://www.amazon.com/gp/video/*',
  ],
  runAt: 'document_idle',
  main(ctx) {
    const subtitles = new VideoSubtitles(primeSite);
    void subtitles.start();
    ctx.addEventListener(window, 'wxt:locationchange', () => subtitles.onLocation());
    ctx.onInvalidated(() => subtitles.stop());
  },
});
