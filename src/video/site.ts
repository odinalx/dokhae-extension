import type { Settings } from '../types';

/*
 * What the subtitle player (src/video/player.ts) needs to know about one
 * video site. Everything that differs between Netflix and YouTube sits behind
 * this interface: where the player draws its subtitles, how to read them, the
 * title, the link back and how to seek. The rest (analysis, overlay, panel,
 * shortcuts, auto-pause) is shared.
 */

/** The settings that are on/off switches. */
export type BooleanSetting = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

export interface SubtitleSite {
  /**
   * Short id, also the prefix of this site's storage keys and CSS hooks
   * ('netflix' keeps the keys the Netflix script always used).
   */
  id: string;
  /** The setting that turns the interactive subtitles on. */
  enabledSetting: BooleanSetting;
  /** The setting that pauses at the end of each line. */
  autoPauseSetting: BooleanSetting;
  /** The video being watched, or null away from the player. */
  watchId(loc: Location): string | null;
  /** The player's subtitle layer, or null while it has none. */
  findSubtitleRoot(doc: Document): Element | null;
  /** The lines on screen, in reading order, empty ones dropped. */
  readLines(root: Element): string[];
  /** An added element that may be a new subtitle layer (see VideoSubtitles.concernsSubtitles). */
  mayBeSubtitleLayer(el: Element): boolean;
  /** Selector of the player's own subtitles, hidden while Dokhae draws Korean in their place. */
  nativeSelector: string;
  /** The block whose position the overlay copies, so it moves with the player's controls. */
  textBlock(root: Element): Element | null;
  /**
   * The player's box when it does not fill the window (YouTube outside
   * fullscreen): the overlay is centred on it. Null for a full-window player.
   */
  playerBox(doc: Document): Element | null;
  /** The title as the player shows it, or ''. */
  readTitle(doc: Document): string;
  /** The card's link back: the same video, at the moment the word was heard. */
  watchUrl(id: string, seconds: number): string;
  /** The card's source label ("Netflix · Titre"). */
  cardSourceLabel(title: string): string;
  /** The <video> being played. */
  video(doc: Document): HTMLVideoElement | null;
  /** Move playback to `seconds` on the <video>'s clock. */
  seek(video: HTMLVideoElement, seconds: number): void;
  /**
   * How long a line waits on screen before the site is asked, when it differs
   * from LineAnalyzer's default (a line still being written word by word).
   */
  dwellMs?(root: Element): number | undefined;
  /** The shortcut reminder shown the first few times. */
  hint: string;
}
