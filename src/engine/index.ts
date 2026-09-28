import type { Engine } from './types';

/**
 * The engine for the browser being built, chosen at build time
 * (`wxt build -b firefox` sets import.meta.env.FIREFOX): the other one, and
 * Tesseract itself in the Chrome background, never reach the bundle.
 */
export async function getEngine(): Promise<Engine> {
  if (import.meta.env.FIREFOX) return (await import('./direct')).directEngine;
  return (await import('./offscreen')).offscreenEngine;
}

export type { Engine };
