// One-click connect: the message contract between the site's
// /connect-extension page and the extension. Documented for the site side in
// docs/connect-extension.md; keep the two in sync.

/** Shape of a Dokhae device token, as handed over by the connect page. */
export const TOKEN_RE = /^sori_[A-Za-z0-9_-]{20,}$/;

/** Path of the site page allowed to hand the extension a token. */
export const CONNECT_PATH = '/connect-extension';

/** page -> extension */
export interface ConnectRequest {
  source: 'dokhae-site';
  type: 'DOKHAE_CONNECT';
  token: string;
}

/**
 * extension -> page, once on load: the extension is installed. Since 1.3 it
 * also says which install this is (so reconnecting takes the same device
 * place back), how to name it in the account's device list, and that it
 * stores the token /api/me rotates.
 */
export interface PresentNotice {
  source: 'dokhae-extension';
  type: 'DOKHAE_PRESENT';
  version: string;
  installId: string;
  deviceName: string;
  rotates: true;
}

/** Machine-readable reasons a connect failed, for the page to word itself. */
export type ConnectErrorCode =
  | 'invalid_token' // the site refused the token (401)
  | 'network' // the extension could not reach the site to verify it
  | 'internal'; // anything else (extension updated mid-flight, …)

/** extension -> page, the answer to a ConnectRequest. */
export interface ConnectReply {
  source: 'dokhae-extension';
  type: 'DOKHAE_CONNECTED';
  ok: boolean;
  email?: string;
  /** True when the account has a plan: the page can suggest pricing otherwise. */
  subscribed?: boolean;
  error?: ConnectErrorCode;
}

/**
 * The token of a well-formed connect request, or null.
 *
 * Anything else posted on the page (other scripts, our own replies, a token
 * with the wrong shape) is ignored rather than answered.
 */
export function connectToken(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.source !== 'dokhae-site' || d.type !== 'DOKHAE_CONNECT') return null;
  return typeof d.token === 'string' && TOKEN_RE.test(d.token) ? d.token : null;
}

/** True when `url` is the site's connect page (any query or hash). */
export function isConnectPage(url: string | undefined, siteUrl: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.origin === new URL(siteUrl).origin && u.pathname.startsWith(CONNECT_PATH);
  } catch {
    return false;
  }
}
