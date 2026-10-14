import { youtubeSite } from '../src/youtube/site';
import { VideoSubtitles } from '../src/video/player';

/*
 * YouTube's Korean captions (made by the channel or automatic), redrawn by
 * Dokhae (src/video/player.ts, with what is specific to YouTube in
 * src/youtube/). YouTube is a single-page app, so the script matches the
 * whole of www.youtube.com and stays idle away from a video.
 */
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    const subtitles = new VideoSubtitles(youtubeSite);
    void subtitles.start();
    ctx.addEventListener(window, 'wxt:locationchange', () => subtitles.onLocation());
    ctx.onInvalidated(() => subtitles.stop());
  },
});
