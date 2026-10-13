/**
 * DOM event the Netflix subtitle script fires to move playback, handled by
 * entrypoints/netflix-seek.content.ts in the page's world. Its detail is the
 * target time in seconds on the <video> clock, as a string: a primitive is
 * the one thing both browsers pass between the two worlds unchanged.
 */
export const SEEK_EVENT = 'dokhae:netflix-seek';

export function requestSeek(seconds: number): void {
  document.dispatchEvent(new CustomEvent(SEEK_EVENT, { detail: String(Math.max(0, seconds)) }));
}
