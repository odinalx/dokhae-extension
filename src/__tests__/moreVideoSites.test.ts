import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import * as viki from '../viki/site';
import * as disney from '../disney/site';
import * as prime from '../prime/site';

const page = (body: string, title = '') =>
  parseHTML(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`).document;

const read = (site: { findSubtitleRoot: (d: ParentNode) => Element | null; readSubtitleLines: (r: Element) => string[] }, body: string) => {
  const root = site.findSubtitleRoot(page(body));
  return root ? site.readSubtitleLines(root) : null;
};

describe('Viki', () => {
  it('reads video.js cues, a <br> starting a new line', () => {
    expect(
      read(viki, `
        <div class="video-js"><video class="vjs-tech"></video>
          <div class="vjs-text-track-display" aria-live="off">
            <div style="position: absolute; inset: 0px; margin: 1.5%;">
              <div class="vjs-text-track-cue vjs-text-track-cue-ko" style="position: absolute; inset: auto 0px 0px; text-align: center;">
                <div style="font-size: 26px;">김비서가 왜 그럴까<br>정말 몰라요</div>
              </div>
            </div>
          </div>
        </div>`),
    ).toEqual(['김비서가 왜 그럴까', '정말 몰라요']);
  });

  it('gives no line between cues, and none without the layer', () => {
    expect(read(viki, `<div class="vjs-text-track-display"><div></div></div>`)).toEqual([]);
    expect(read(viki, `<div class="video-js"></div>`)).toBeNull();
  });

  it('knows the episode and links back to it', () => {
    expect(viki.watchId('/videos/1133753v-whats-wrong-with-secretary-kim-episode-1')).toBe('1133753v');
    expect(viki.watchId('/tv/35835c-whats-wrong-with-secretary-kim')).toBeNull();
    expect(viki.watchUrl('1133753v')).toBe('https://www.viki.com/videos/1133753v');
    expect(viki.readTitle(page('', 'Secretary Kim - Episode 1 | Rakuten Viki'))).toBe('Secretary Kim - Episode 1');
    expect(viki.cardSourceLabel('')).toBe('Viki');
  });
});

describe('Disney+', () => {
  it('reads the hive renderer, one line per span', () => {
    expect(
      read(disney, `
        <div class="TimedTextOverlay">
          <div class="hive-subtitle-renderer-wrapper"><div class="hive-subtitle-renderer-cue-positioning-box">
            <div class="hive-subtitle-renderer-cue-window">
              <span class="hive-subtitle-renderer-line">너 어디 가?</span>
              <span class="hive-subtitle-renderer-line">같이 가자</span>
            </div>
          </div></div>
        </div>`),
    ).toEqual(['너 어디 가?', '같이 가자']);
  });

  it('reads the older dss renderer and the Shaka container', () => {
    expect(
      read(disney, `<div class="dss-subtitle-renderer-wrapper"><div class="dss-subtitle-renderer-cue"><span class="dss-subtitle-renderer-line">괜찮아요</span></div></div>`),
    ).toEqual(['괜찮아요']);
    expect(
      read(disney, `<div class="shaka-text-container"><div><span>첫 줄</span></div><div><span>둘째 줄</span></div></div>`),
    ).toEqual(['첫 줄', '둘째 줄']);
  });

  it('knows the title on /play/ and /video/, with or without a locale', () => {
    expect(disney.watchId('/fr-fr/play/7c5a3f8e-1b2c-4d5e-9f00-112233445566')).toBe('play/7c5a3f8e-1b2c-4d5e-9f00-112233445566');
    expect(disney.watchId('/video/abc123def')).toBe('video/abc123def');
    expect(disney.watchId('/fr-fr/browse/entity-1')).toBeNull();
    expect(disney.watchUrl('play/abc123def')).toBe('https://www.disneyplus.com/play/abc123def');
    expect(disney.readTitle(page('', 'Moving | Disney+'))).toBe('Moving');
  });
});

describe('Prime Video', () => {
  it('reads each caption span as a line', () => {
    expect(
      read(prime, `
        <div id="dv-web-player"><div class="webPlayerSDKContainer"><video></video>
          <div class="atvwebplayersdk-captions-overlay" style="font-size: 30px;">
            <div style="position: absolute; bottom: 10%;">
              <span class="atvwebplayersdk-captions-region">
                <span class="atvwebplayersdk-captions-text">당신을 믿어요</span><br>
                <span class="atvwebplayersdk-captions-text">정말이에요</span>
              </span>
            </div>
          </div>
        </div></div>`),
    ).toEqual(['당신을 믿어요', '정말이에요']);
  });

  it('reads the title block, else the tab', () => {
    expect(
      prime.readTitle(page(`<div class="atvwebplayersdk-title-text">Le Roi</div><div class="atvwebplayersdk-subtitle-text">S1 É2</div>`)),
    ).toBe('Le Roi · S1 É2');
    expect(prime.readTitle(page('', 'Prime Video: Le Roi'))).toBe('Le Roi');
    expect(prime.readTitle(page('', 'Prime Video'))).toBe('');
  });

  it('links back to the title on its store', () => {
    expect(prime.watchId('/detail/0ABCDEFGHIJ/ref=atv_hm')).toBe('0ABCDEFGHIJ');
    expect(prime.watchId('/gp/video/detail/B0ABCDEFGH')).toBe('B0ABCDEFGH');
    expect(prime.watchId('/storefront')).toBe('prime');
    expect(prime.watchUrl('0ABCDEFGHIJ', 'https://www.primevideo.com')).toBe('https://www.primevideo.com/detail/0ABCDEFGHIJ');
    expect(prime.watchUrl('B0ABCDEFGH', 'https://www.amazon.fr')).toBe('https://www.amazon.fr/gp/video/detail/B0ABCDEFGH');
  });
});
