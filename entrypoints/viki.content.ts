import { vikiSite } from '../src/viki/site';
import { VideoSubtitles } from '../src/video/player';

/*
 * Viki's Korean subtitles, redrawn by Dokhae (src/video/player.ts, with what
 * is specific to Viki in src/viki/). The whole site is matched because it is
 * a single-page app; the script stays idle away from /videos/.
 */
export default defineContentScript({
  matches: ['https://www.viki.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    const subtitles = new VideoSubtitles(vikiSite);
    void subtitles.start();
    ctx.addEventListener(window, 'wxt:locationchange', () => subtitles.onLocation());
    ctx.onInvalidated(() => subtitles.stop());
  },
});
