import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  cardSourceLabel,
  findSubtitleRoot,
  readEpisodeTitle,
  readSubtitleLines,
  subtitleText,
  watchId,
  watchUrl,
} from '../netflix/subtitles';

const page = (body: string, title = 'Netflix') =>
  parseHTML(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`).document;

const lines = (body: string) => {
  const root = findSubtitleRoot(page(body));
  return root ? readSubtitleLines(root) : null;
};

describe('findSubtitleRoot / readSubtitleLines', () => {
  it('reads a single line as the player draws it', () => {
    expect(
      lines(`
        <div class="watch-video"><video></video>
          <div class="player-timedtext" style="display: block; inset: 0px 0px 104px;">
            <div class="player-timedtext-text-container" style="display: block; white-space: nowrap; text-align: center; position: absolute; left: 520px; top: 610px;">
              <span style="font-size:32px;line-height:normal;font-weight:normal;color:#ffffff;text-shadow:#000000 0px 0px 7px;font-family:Netflix Sans,Helvetica Nueue,Helvetica,Arial,sans-serif;font-weight:bolder">너 지금 어디야?</span>
            </div>
          </div>
        </div>`),
    ).toEqual(['너 지금 어디야?']);
  });

  it('splits on <br> and keeps the order', () => {
    expect(
      lines(`
        <div class="player-timedtext">
          <div class="player-timedtext-text-container">
            <span><span>- 밥 먹었어?</span><br><span>- 아직 안 먹었어</span></span>
          </div>
        </div>`),
    ).toEqual(['- 밥 먹었어?', '- 아직 안 먹었어']);
  });

  it('reads several positioned blocks one after the other', () => {
    expect(
      lines(`
        <div class="player-timedtext">
          <div class="player-timedtext-text-container" style="top: 40px"><span>[문 닫히는 소리]</span></div>
          <div class="player-timedtext-text-container" style="top: 600px"><span>그만해<br/>제발</span></div>
        </div>`),
    ).toEqual(['[문 닫히는 소리]', '그만해', '제발']);
  });

  it('tidies whitespace and drops empty lines', () => {
    expect(
      lines(`
        <div class="player-timedtext">
          <div class="player-timedtext-text-container"><span>  괜찮아   정말 </span><br><br><span> </span></div>
        </div>`),
    ).toEqual(['괜찮아 정말']);
  });

  it('skips blocks the player hid', () => {
    expect(
      lines(`
        <div class="player-timedtext">
          <div class="player-timedtext-text-container" style="display: none"><span>이전 대사</span></div>
          <div class="player-timedtext-text-container"><span>지금 대사</span></div>
        </div>`),
    ).toEqual(['지금 대사']);
  });

  it('gives no lines between cues', () => {
    expect(lines(`<div class="player-timedtext" style="display: block;"></div>`)).toEqual([]);
  });

  it('is null without a subtitle layer', () => {
    expect(lines(`<div class="watch-video"><video></video></div>`)).toBeNull();
  });

  it('still finds a renamed layer by its timedtext class', () => {
    expect(
      lines(`
        <div class="nf-player-timedtext-layer">
          <div class="nf-timedtext-block"><span>새로운 클래스</span></div>
        </div>`),
    ).toEqual(['새로운 클래스']);
  });

  it('treats inner divs as line breaks when the blocks lose their class', () => {
    expect(
      lines(`
        <div class="player-timedtext">
          <div><span>첫 줄</span></div><div><span>둘째 줄</span></div>
        </div>`),
    ).toEqual(['첫 줄', '둘째 줄']);
  });

  it('joins lines with a space for the analysis and the card', () => {
    expect(subtitleText(['- 밥 먹었어?', '- 아직'])).toBe('- 밥 먹었어? - 아직');
  });
});

describe('readEpisodeTitle', () => {
  it('joins the parts of the player title', () => {
    const doc = page(`<div data-uia="video-title"><h4>오징어 게임</h4><span>E3</span><span>우산을 쓴 남자</span></div>`);
    expect(readEpisodeTitle(doc)).toBe('오징어 게임 · E3 · 우산을 쓴 남자');
  });

  it('reads a film title written as plain text', () => {
    expect(readEpisodeTitle(page(`<div data-uia="video-title">기생충</div>`))).toBe('기생충');
  });

  it('falls back to the tab title, without the brand', () => {
    expect(readEpisodeTitle(page('', 'Kingdom | Netflix'))).toBe('Kingdom');
  });

  it('is empty when the page only says Netflix', () => {
    expect(readEpisodeTitle(page(''))).toBe('');
  });
});

describe('watch addresses', () => {
  it('reads the title id from the player path', () => {
    expect(watchId('/watch/81234567')).toBe('81234567');
    expect(watchId('/browse')).toBeNull();
  });

  it('links back to the moment', () => {
    expect(watchUrl('81234567', 754.8)).toBe('https://www.netflix.com/watch/81234567?t=754');
    expect(watchUrl('81234567', 0)).toBe('https://www.netflix.com/watch/81234567');
  });

  it('labels the source', () => {
    expect(cardSourceLabel('')).toBe('Netflix');
    expect(cardSourceLabel('Kingdom · E1')).toBe('Netflix · Kingdom · E1');
  });
});
