import { disneySite } from '../src/disney/site';
import { VideoSubtitles } from '../src/video/player';

/*
 * Disney+'s Korean subtitles, redrawn by Dokhae (src/video/player.ts, with
 * what is specific to Disney+ in src/disney/; seeking goes through
 * disney-seek.content.ts). The whole site is matched because it is a
 * single-page app; the script stays idle away from the player.
 */
export default defineContentScript({
  matches: ['https://www.disneyplus.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    const subtitles = new VideoSubtitles(disneySite);
    void subtitles.start();
    ctx.addEventListener(window, 'wxt:locationchange', () => subtitles.onLocation());
    ctx.onInvalidated(() => subtitles.stop());
  },
});
