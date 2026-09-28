import { recognizeKorean, warmOcr } from '../tesseract';
import type { Engine } from './types';

/*
 * Firefox: the background is an event page with a DOM, so it starts the
 * Tesseract Worker and plays audio itself, with no offscreen document
 * (an API Firefox does not have).
 */
export const directEngine: Engine = {
  warm: warmOcr,
  recognize: recognizeKorean,
  async play(audioDataUrl) {
    await new Audio(audioDataUrl).play();
  },
};
