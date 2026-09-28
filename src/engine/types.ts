/**
 * What the background needs from the browser to read a bubble and speak:
 * the only place Chrome and Firefox builds differ (see src/engine/index.ts).
 */
export interface Engine {
  /** Starts OCR ahead of a scan (the overlay just opened). */
  warm(): Promise<void>;
  /** Reads the Korean in a prepared crop. */
  recognize(
    imageDataUrl: string,
    onProgress: (status: string, progress: number) => void,
  ): Promise<{ text: string; uncertain: number[] }>;
  /** Plays fetched pronunciation audio. */
  play(audioDataUrl: string): Promise<void>;
}
