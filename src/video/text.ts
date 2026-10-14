/*
 * Small rules on subtitle text shared by every video site, kept DOM-free for
 * the tests.
 */

/** One string for the API and the card: the lines joined by a space. */
export function subtitleText(lines: string[]): string {
  return lines.join(' ');
}

/**
 * Whether `lines` carry on the line already shown rather than replace it:
 * the same text with more words, or the last row moved up to the top as a
 * rolling caption scrolls.
 */
export function continues(shown: { lines: string[]; text: string }, lines: string[], text: string): boolean {
  if (text.length > shown.text.length && text.startsWith(shown.text)) return true;
  const last = shown.lines[shown.lines.length - 1];
  return shown.lines.length > 1 && lines.length > 0 && lines[0] === last;
}
