import { describe, expect, it } from 'vitest';
import { continues, subtitleText } from '../video/text';

const shown = (lines: string[]) => ({ lines, text: subtitleText(lines) });

describe('continues', () => {
  it('is true when a line only grows', () => {
    expect(continues(shown(['안녕하세요']), ['안녕하세요 여러분'], '안녕하세요 여러분')).toBe(true);
    expect(continues(shown(['안녕하세요']), ['안녕하세요', '오늘은'], '안녕하세요 오늘은')).toBe(true);
  });

  it('is true when a rolling caption scrolls up a row', () => {
    expect(continues(shown(['안녕하세요 여러분', '오늘은']), ['오늘은', '날씨가'], '오늘은 날씨가')).toBe(true);
  });

  it('is false for a new line', () => {
    expect(continues(shown(['밥 먹었어?']), ['아직 안 먹었어'], '아직 안 먹었어')).toBe(false);
    expect(continues(shown(['밥 먹었어?']), ['밥 먹었어?'], '밥 먹었어?')).toBe(false);
  });
});
