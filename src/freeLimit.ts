// The free allowance as the reader sees it. Its own module because both the
// site client (src/site.ts, for the API's free_limit_reached) and the access
// state (src/access.ts) word it, and access.ts already imports site.ts.

/** The allowance to quote before the site said it (it says it in /api/me). */
export const FREE_PER_DAY_FALLBACK = 5;

/** The free analyses are spent for today. */
export function freeLimitMessage(perDay = FREE_PER_DAY_FALLBACK): string {
  return `Tu as utilisé tes ${perDay} analyses gratuites du jour. Reviens demain, ou passe à Dokhae complet pour analyser sans limite (premier mois à 2,99 € pour un nouveau compte).`;
}
