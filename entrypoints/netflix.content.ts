import { netflixSite } from '../src/netflix/site';
import { VideoSubtitles } from '../src/video/player';

/*
 * Netflix's Korean subtitles, redrawn by Dokhae (src/video/player.ts, with
 * what is specific to Netflix in src/netflix/). The script matches all of
 * www.netflix.com because the site is a single-page app: going from the
 * catalogue to a title never loads a new page, so a script limited to /watch/
 * would never start. It stays idle outside /watch/. The host is the same
 * either way, so the permission is no wider.
 */
export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    const subtitles = new VideoSubtitles(netflixSite);
    void subtitles.start();
    ctx.addEventListener(window, 'wxt:locationchange', () => subtitles.onLocation());
    ctx.onInvalidated(() => subtitles.stop());
  },
});
