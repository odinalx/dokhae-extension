/*
 * Seeking on Disney+ goes through its player's own API (see
 * entrypoints/disney-seek.content.ts, which runs in the page's world): the
 * isolated subtitle script sends the target time, on the <video>'s clock, as
 * a string in a DOM event.
 */
export const SEEK_EVENT = 'dokhae:disney-seek';

export function requestSeek(seconds: number): void {
  document.dispatchEvent(new CustomEvent(SEEK_EVENT, { detail: String(Math.max(0, seconds)) }));
}
