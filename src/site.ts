import { SITE_URL } from './config';
import { TOKEN_RE } from './connect';
import { romanize } from './romanize';
import { liveToken, rotateSiteToken } from './settings';
import type { AnalysisResult, AnkiCardDraft } from './types';

// Client for the Dokhae website's extension API (see the site's src/routes/api).
// Auth is this device's bearer token ("sori_…"), handed over by the site's
// /connect-extension page and rotated daily through GET /api/me.

export interface SiteAccount {
  email: string;
  name: string;
  plan: string;
  subscribed: boolean;
}

// Error carrying the HTTP status + the site's machine-readable `error` code
// ("subscription_required", …) so callers can react to specific failures.
export class SiteApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    /** For `device_revoked`: why ("reuse", "replaced", "user", …). */
    readonly detail?: string
  ) {
    super(message);
  }
}

/** Why the site disconnected this browser, in words the reader can act on. */
export function revokedMessage(reason: string | undefined): string {
  switch (reason) {
    case 'reuse':
      return `La connexion de ce navigateur a été utilisée depuis un autre appareil, on l'a coupée par sécurité. Reconnecte ton compte.`;
    case 'replaced':
      return `Ce navigateur a été remplacé par un autre sur ton compte. Reconnecte-le pour reprendre sa place.`;
    case 'inactive':
      return `Ce navigateur n'a pas servi depuis longtemps et a été déconnecté. Reconnecte ton compte.`;
    case 'password':
      return `Ton mot de passe a changé : reconnecte ton compte.`;
    default:
      return `Ce navigateur a été déconnecté de ton compte. Reconnecte-le en un clic.`;
  }
}

const FRENCH_ERRORS: Record<string, string> = {
  subscription_required: `Scanner fait partie de l'abonnement Dokhae. Pour un nouveau compte, le premier mois est à 2,99\u00a0€.`,
  rate_limited: 'Trop de scans d\'un coup. Réessaie dans un moment.',
  http_401: `Ton accès à Dokhae a expiré ou a été révoqué. Reconnecte ton compte.`,
};

async function request(token: string, path: string, init?: RequestInit): Promise<unknown> {
  token = await liveToken(token);
  let res: Response;
  try {
    res = await fetch(`${SITE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new SiteApiError(`Impossible de joindre ${SITE_URL}. Vérifie ta connexion.`, 0, 'network');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof body.error === 'string' ? body.error : `http_${res.status}`;
    if (code === 'device_revoked') {
      const reason = typeof body.reason === 'string' ? body.reason : undefined;
      throw new SiteApiError(revokedMessage(reason), res.status, code, reason);
    }
    // The API speaks English (it also serves the app); the codes the reader
    // can act on get French wording here.
    const french = FRENCH_ERRORS[res.status === 401 ? 'http_401' : code];
    const message =
      french ? french
      : typeof body.message === 'string' ? body.message
      : typeof body.error === 'string' ? body.error
      : `Erreur du site Dokhae (HTTP ${res.status})`;
    throw new SiteApiError(message, res.status, code);
  }
  return body;
}

/**
 * GET /api/me: validates the token and reports the subscription state. When
 * the token is due for rotation the answer carries its replacement, stored
 * right away: the old one only works a few more minutes.
 */
export async function fetchAccount(token: string): Promise<SiteAccount> {
  const live = await liveToken(token);
  const body = (await request(live, '/api/me')) as Partial<SiteAccount> & { token?: unknown };
  if (typeof body.token === 'string' && TOKEN_RE.test(body.token)) {
    await rotateSiteToken(live, body.token);
  }
  return {
    email: String(body.email ?? ''),
    name: String(body.name ?? ''),
    plan: String(body.plan ?? 'none'),
    subscribed: Boolean(body.subscribed),
  };
}

/**
 * POST /api/analyze — Korean text in, analysed words out.
 *
 * This pipeline (Kiwi segmentation + translation + grammar) used to run
 * locally: Kiwi's wasm in a sandboxed iframe, driven from the offscreen
 * document. It moved to the server so the mobile app and this extension share
 * one implementation — and so the ~84 MB Kiwi model ships once, not with every
 * copy of the extension.
 *
 * OCR stays local. It's free, offline, and Tesseract is good at the crisp
 * rendered text of a webtoon panel.
 */
export async function analyzeOnSite(
  token: string,
  text: string,
  uncertain?: number[]
): Promise<AnalysisResult> {
  const body = (await request(token, '/api/analyze', {
    method: 'POST',
    // The extension's readers are French, like the site: glosses and grammar
    // notes come back in French. The API defaults to English for the app.
    // `uncertain` (OCR scans only) turns on the server's repair of syllables
    // Tesseract's model cannot print; `text` then comes back corrected.
    body: JSON.stringify(uncertain ? { text, lang: 'fr', uncertain } : { text, lang: 'fr' }),
  })) as Partial<AnalysisResult>;
  return {
    text: String(body.text ?? ''),
    sentenceTranslation: String(body.sentenceTranslation ?? ''),
    tone: String(body.tone ?? ''),
    words: Array.isArray(body.words) ? body.words : [],
  };
}

export interface SiteDeck {
  id: string;
  name: string;
  count: number;
}

/** GET /api/decks — the decks a captured word can be filed into. */
export async function fetchDecks(token: string): Promise<SiteDeck[]> {
  const body = (await request(token, '/api/decks')) as { decks?: unknown };
  if (!Array.isArray(body.decks)) return [];
  return body.decks.map((d) => {
    const deck = d as Partial<SiteDeck>;
    return {
      id: String(deck.id ?? ''),
      name: String(deck.name ?? ''),
      count: Number(deck.count ?? 0),
    };
  });
}

// Shape POSTed to /api/cards (the site's WordInput schema).
function toWordInput(card: AnkiCardDraft) {
  const term = (card.base || card.infinitive || card.word).trim().slice(0, 60);
  const translation =
    dedupe([card.wordTranslation, ...card.meanings]).join('; ').slice(0, 200) || term;
  return {
    term,
    reading: romanize(term),
    translation,
    example: card.sentence,
    exampleTranslation: card.sentenceTranslation,
    source: card.source || 'Dokhae Extension',
    // Only web pages: a local file or an extension page is no link to share.
    // Cut short, an address is a broken link: past the site's 500-character
    // limit it is simply left out.
    ...(card.sourceUrl && /^https?:\/\//.test(card.sourceUrl) && card.sourceUrl.length <= 500
      ? { sourceUrl: card.sourceUrl }
      : {}),
  };
}

/**
 * POST /api/cards — save one captured word into the user's Dokhae deck.
 *
 * An empty `deckId` is left out of the body entirely: the site then files the
 * word in the account's first deck, which is what a user who never opened the
 * deck setting expects.
 */
export async function sendCardToSite(
  token: string,
  card: AnkiCardDraft,
  deckId = ''
): Promise<'added' | 'exists'> {
  const body = (await request(token, '/api/cards', {
    method: 'POST',
    body: JSON.stringify({ ...toWordInput(card), ...(deckId ? { deckId } : {}) }),
  })) as { status?: string };
  return body.status === 'exists' ? 'exists' : 'added';
}

export interface SiteSendResult {
  addedIds: string[]; // draft ids accepted by the site (incl. duplicates)
  droppedIds: string[]; // draft ids the site rejected as invalid (422): retrying won't help
  failed: number;
  failures: string[]; // "word: reason" for each failure
}

/** The site rejected the card itself (422), not the moment: resending won't help. */
export function isRejectedCard(e: unknown): boolean {
  return e instanceof SiteApiError && e.status === 422;
}

export const REJECTED_CARD_NOTICE = 'refusée par Dokhae (mot ou traduction invalide), retirée de la file';

/** Send a batch of queued cards to the site; mirrors sendCardsToAnki's shape. */
export async function sendCardsToSite(
  token: string,
  cards: AnkiCardDraft[],
  deckId = ''
): Promise<SiteSendResult> {
  const addedIds: string[] = [];
  const droppedIds: string[] = [];
  const failures: string[] = [];
  for (const card of cards) {
    try {
      await sendCardToSite(token, card, deckId);
      addedIds.push(card.id);
    } catch (e) {
      if (isRejectedCard(e)) {
        droppedIds.push(card.id);
        failures.push(`${card.word}\u00a0: ${REJECTED_CARD_NOTICE}`);
      } else {
        failures.push(`${card.word}\u00a0: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return { addedIds, droppedIds, failed: failures.length, failures };
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** POST /api/device/logout: sign-out ends the token on the site too, freeing this browser's place. */
export async function logoutDevice(token: string): Promise<void> {
  await request(token, '/api/device/logout', { method: 'POST', body: '{}' });
}
