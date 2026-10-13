/*
 * The subtitle lines seen so far in this video, with the moment each one
 * started (the <video>'s currentTime when it appeared). That is what
 * "réplique précédente" and "rejouer" jump to: Netflix's own timings are in
 * the subtitle file, which Dokhae never downloads.
 */

export interface Cue {
  /** The line as read on screen (lines joined by a space). */
  text: string;
  /** Seconds, on the <video> element's clock. */
  start: number;
}

/**
 * The same line seen again this close to where it was first seen is the same
 * cue: a replay, or a seek landing in the middle of it. Two real lines with
 * identical text this close together are rare enough to merge.
 */
const SAME_CUE_WINDOW = 6;

/** Lines further back than this are forgotten (a feature film is about 1500). */
const MAX_CUES = 3000;

export class CueHistory {
  private cues: Cue[] = [];

  /** Every cue, sorted by start. */
  all(): readonly Cue[] {
    return this.cues;
  }

  clear(): void {
    this.cues = [];
  }

  /**
   * A line appeared at `time`. Returns its cue: an existing one when the line
   * was already seen around there (its start moves earlier if this sighting
   * is earlier, as when a seek first landed mid-line), a new one otherwise.
   */
  record(text: string, time: number): Cue {
    const known = this.cues.find((c) => c.text === text && Math.abs(c.start - time) <= SAME_CUE_WINDOW);
    if (known) {
      if (time < known.start) {
        known.start = time;
        this.cues.sort((a, b) => a.start - b.start);
      }
      return known;
    }
    const cue = { text, start: time };
    // Kept sorted: after a seek back, new lines land between old ones.
    let i = this.cues.length;
    while (i > 0 && this.cues[i - 1]!.start > time) i--;
    this.cues.splice(i, 0, cue);
    if (this.cues.length > MAX_CUES) {
      // Drop the cue furthest from where the viewer is now.
      if (Math.abs(this.cues[0]!.start - time) > Math.abs(this.cues[this.cues.length - 1]!.start - time)) {
        this.cues.shift();
      } else {
        this.cues.pop();
      }
    }
    return cue;
  }

  /** The latest cue that started at or before `time` (a small margin for rounding). */
  at(time: number): Cue | null {
    let found: Cue | null = null;
    for (const c of this.cues) {
      if (c.start <= time + 0.05) found = c;
      else break;
    }
    return found;
  }

  /** The cue before this one, or null for the first. */
  before(cue: Cue): Cue | null {
    const i = this.cues.indexOf(cue);
    return i > 0 ? this.cues[i - 1]! : null;
  }

  /**
   * Where "réplique précédente" goes. `anchor` is the line the viewer is on:
   * the one on screen, or the one a jump just went to and that has not shown
   * yet (so pressing twice goes back two lines, not one). With an anchor, the
   * line before it (or the anchor itself at the very start). Between lines,
   * the last one shown, the line the viewer just missed.
   */
  previous(time: number, anchor: Cue | null): Cue | null {
    if (anchor && this.cues.includes(anchor)) return this.before(anchor) ?? anchor;
    return this.at(time);
  }

  /** Where "rejouer" goes: the anchor (see previous), or the last line shown. */
  replay(time: number, anchor: Cue | null): Cue | null {
    if (anchor && this.cues.includes(anchor)) return anchor;
    return this.at(time);
  }
}
