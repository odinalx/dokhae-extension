import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  captionBlock,
  cardSourceLabel,
  findSubtitleRoot,
  isRolling,
  readSubtitleLines,
  readVideoTitle,
  watchId,
  watchUrl,
} from '../youtube/subtitles';

const page = (body: string, title = 'YouTube') =>
  parseHTML(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`).document;

const player = (windows: string) => `
  <div id="movie_player" class="html5-video-player">
    <div class="html5-video-container"><video class="video-stream html5-main-video"></video></div>
    <div class="ytp-caption-window-container" id="ytp-caption-window-container">${windows}</div>
  </div>`;

const lines = (windows: string) => {
  const root = findSubtitleRoot(page(player(windows)));
  return root ? readSubtitleLines(root) : null;
};

describe('findSubtitleRoot / readSubtitleLines', () => {
  it('reads a caption made by the channel, one segment per line', () => {
    expect(
      lines(`
        <div class="caption-window ytp-caption-window-bottom" id="caption-window-1" style="touch-action: none; text-align: center; left: 50%; bottom: 2%; width: 400px; margin-left: -200px;">
          <span class="captions-text" style="overflow-wrap: normal; display: block;">
            <span class="caption-visual-line" style="display: block;"><span class="ytp-caption-segment" style="display: inline-block; white-space: pre-wrap; font-size: 22px;">오늘 뭐 먹을까?</span></span>
          </span>
        </div>`),
    ).toEqual(['오늘 뭐 먹을까?']);
  });

  it('keeps two visual lines apart and in order', () => {
    expect(
      lines(`
        <div class="caption-window ytp-caption-window-bottom">
          <span class="captions-text">
            <span class="caption-visual-line"><span class="ytp-caption-segment">- 밥 먹었어?</span></span>
            <span class="caption-visual-line"><span class="ytp-caption-segment">- 아직</span></span>
          </span>
        </div>`),
    ).toEqual(['- 밥 먹었어?', '- 아직']);
  });

  it('joins the word segments of automatic captions into their line', () => {
    const root = findSubtitleRoot(
      page(
        player(`
        <div class="caption-window ytp-caption-window-bottom ytp-caption-window-rollup">
          <span class="captions-text">
            <span class="caption-visual-line"><span class="ytp-caption-segment">안녕하세요</span><span class="ytp-caption-segment"> 여러분</span></span>
            <span class="caption-visual-line"><span class="ytp-caption-segment">오늘은</span><span class="ytp-caption-segment">  </span></span>
          </span>
        </div>`),
      ),
    )!;
    expect(readSubtitleLines(root)).toEqual(['안녕하세요 여러분', '오늘은']);
    expect(isRolling(root)).toBe(true);
  });

  it('leaves hidden windows out and reads nothing without captions', () => {
    expect(
      lines(`
        <div class="caption-window" style="display: none"><span class="caption-visual-line"><span class="ytp-caption-segment">숨김</span></span></div>`),
    ).toEqual([]);
    expect(findSubtitleRoot(page('<div id="movie_player"><video></video></div>'))).toBeNull();
  });

  it('places the overlay on the bottom window when there are several', () => {
    const root = findSubtitleRoot(
      page(
        player(`
        <div class="caption-window ytp-caption-window-top" id="top"><span class="caption-visual-line"><span class="ytp-caption-segment">[음악]</span></span></div>
        <div class="caption-window ytp-caption-window-bottom" id="bottom"><span class="caption-visual-line"><span class="ytp-caption-segment">가자</span></span></div>`),
      ),
    )!;
    expect(captionBlock(root)?.id).toBe('bottom');
    expect(isRolling(root)).toBe(false);
  });
});

describe('readVideoTitle', () => {
  it('reads the heading under the player', () => {
    const doc = page('<ytd-watch-metadata><h1><yt-formatted-string>IVE 아이브 \'BANG BANG\'  MV</yt-formatted-string></h1></ytd-watch-metadata>');
    expect(readVideoTitle(doc)).toBe("IVE 아이브 'BANG BANG' MV");
  });

  it('falls back to the tab title without the count and the site name', () => {
    expect(readVideoTitle(page('', '(3) 브이로그 | 서울 카페 - YouTube'))).toBe('브이로그 | 서울 카페');
    expect(readVideoTitle(page('', 'YouTube'))).toBe('');
  });
});

describe('watchId / watchUrl / cardSourceLabel', () => {
  it('finds the video id on a watch or live page only', () => {
    expect(watchId('/watch', '?v=dQw4w9WgXcQ&list=PL1')).toBe('dQw4w9WgXcQ');
    expect(watchId('/live/abcDEF12345', '')).toBe('abcDEF12345');
    expect(watchId('/', '')).toBeNull();
    expect(watchId('/results', '?search_query=korean')).toBeNull();
    expect(watchId('/watch', '?v=<script>')).toBeNull();
  });

  it('links back to the moment the word was heard', () => {
    expect(watchUrl('dQw4w9WgXcQ', 83.7)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=83s');
    expect(watchUrl('dQw4w9WgXcQ', 0)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('labels the card with the video title', () => {
    expect(cardSourceLabel('서울 카페')).toBe('YouTube · 서울 카페');
    expect(cardSourceLabel('')).toBe('YouTube');
  });
});
