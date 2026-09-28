import { useCallback, useEffect, useState } from 'react';
import type { ExtensionMessage } from '../../src/types';
import { SITE_URL } from '../../src/config';
import { CONNECT_PATH } from '../../src/connect';
import { revokedMessage } from '../../src/site';
import { koreanSelection } from '../../src/hangul';
import { hasSiteAccess, requestSiteAccess } from '../../src/permissions';

type Status = 'idle' | 'activating' | 'analyzing' | 'error';

interface AccessView {
  ok: boolean;
  reason?: string;
  email?: string;
  plan?: string;
  subscribed?: boolean;
  revokedReason?: string;
}

const PLAN_NAMES: Record<string, string> = {
  monthly: 'mensuel',
  yearly: 'annuel',
  lifetime: 'à vie',
};

/** The mark: Dok's head (public/icon/logo.svg, same file as the site's favicon). */
function Logo() {
  return <img src="/icon/logo.svg" width={34} height={34} alt="" aria-hidden="true" />;
}

function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7V5h16v2M9 19h6M12 5v14" />
    </svg>
  );
}

/**
 * The Korean selected in the active tab, if any. Opening the popup grants
 * activeTab, which is all executeScript needs for the tab's own frame; pages
 * the browser protects (its own pages, its add-on store, PDFs) just give no selection.
 */
async function readSelection(): Promise<{ tabId: number; text: string } | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString() ?? '',
    });
    const text = koreanSelection(frame?.result as string | undefined);
    return text ? { tabId: tab.id, text } : null;
  } catch {
    return null;
  }
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  // null = still checking; the scan button stays enabled meanwhile so a warm
  // cache never blocks a paying user.
  const [access, setAccess] = useState<AccessView | null>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const resp = (await browser.runtime.sendMessage({
        type: 'ACCESS_CHECK',
        // Fresh every time: someone who just paid should not wait for the cache.
        force: true,
      } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
      if (resp && resp.type === 'ACCESS_INFO') {
        setAccess({
          ok: resp.ok, reason: resp.reason, email: resp.email,
          plan: resp.plan, subscribed: resp.subscribed, revokedReason: resp.revokedReason,
        });
      }
    } catch {
      /* background not ready: leave the button usable, scans re-check anyway */
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // Firefox lets readers withhold site access; without it every check fails.
  const [siteAccess, setSiteAccess] = useState<boolean | null>(null);
  useEffect(() => {
    void hasSiteAccess().then(setSiteAccess);
  }, []);
  const allowSite = () => {
    requestSiteAccess()
      .then((ok) => {
        setSiteAccess(ok);
        if (ok) void check();
      })
      .catch(() => {});
  };

  const [selection, setSelection] = useState<{ tabId: number; text: string } | null>(null);
  useEffect(() => {
    void readSelection().then(setSelection);
  }, []);

  const open = (path: string) => {
    void browser.tabs.create({ url: `${SITE_URL}${path}` });
    window.close();
  };
  const openOptions = () => {
    void browser.runtime.openOptionsPage();
    window.close();
  };

  const startScan = async () => {
    setStatus('activating');
    setError('');
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('Aucun onglet actif.');
      // The background injects Dokhae into the tab (activeTab, granted by
      // opening this popup) and opens the scan overlay.
      const resp = (await browser.runtime.sendMessage({
        type: 'START_SCAN',
        tabId: tab.id,
      } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
      if (resp?.type === 'START_SCAN_DONE' && resp.ok) {
        window.close();
        return;
      }
      throw new Error(
        resp?.type === 'START_SCAN_DONE' && resp.message
          ? resp.message
          : "L'extension ne répond pas. Réessaie.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  };

  const analyzeSelection = async () => {
    if (!selection) return;
    setStatus('analyzing');
    setError('');
    try {
      const resp = (await browser.runtime.sendMessage({
        type: 'ANALYZE_SELECTION_IN_TAB',
        tabId: selection.tabId,
        text: selection.text,
      } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
      if (resp?.type === 'START_SCAN_DONE' && resp.ok) {
        window.close();
        return;
      }
      throw new Error(
        resp?.type === 'START_SCAN_DONE' && resp.message
          ? resp.message
          : "L'extension ne répond pas. Réessaie.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  };

  const reason = access && !access.ok ? access.reason : undefined;
  const busy = status === 'activating' || status === 'analyzing';

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <Logo />
          <span className="brand-name">Dokhae</span>
        </div>
        {access?.ok && access.plan ? (
          <span className="plan-chip">{PLAN_NAMES[access.plan] ?? access.plan}</span>
        ) : null}
      </header>

      {siteAccess === false ? (
        <section className="card" aria-labelledby="state-title">
          <h1 id="state-title" className="card-title">Autorise Dokhae</h1>
          <p className="card-text">
            Ton navigateur n’a pas encore autorisé Dokhae à contacter dokhae.fr et les
            dictionnaires. Sans ça, impossible de lire une bulle.
          </p>
          <button className="btn btn-primary" onClick={allowSite}>
            Autoriser
          </button>
        </section>
      ) : reason === 'no-token' || reason === 'invalid-token' ? (
        <section className="card" aria-labelledby="state-title">
          <h1 id="state-title" className="card-title">
            {reason === 'no-token' ? 'Connecte ton compte' : 'Reconnecte ton compte'}
          </h1>
          <p className="card-text">
            {reason === 'no-token'
              ? 'Un clic suffit : Dokhae s’ouvre dans un onglet et relie l’extension à ton compte.'
              : access?.revokedReason
                ? revokedMessage(access.revokedReason)
                : 'Ton accès a expiré ou a été révoqué. Reconnecte l’extension en un clic.'}
          </p>
          <button className="btn btn-primary" onClick={() => open(CONNECT_PATH)}>
            Connecter mon compte
          </button>
          {reason === 'no-token' && (
            <p className="card-foot">
              Pas encore de compte&nbsp;?{' '}
              <button className="btn-link" onClick={() => open('/login?mode=signup&next=/connect-extension')}>Crée-le ici</button>
              {' · '}
              <button className="btn-link" onClick={() => open('/extension')}>Comment ça marche&nbsp;?</button>
            </p>
          )}
        </section>
      ) : reason === 'not-subscribed' ? (
        <section className="card" aria-labelledby="state-title">
          <h1 id="state-title" className="card-title">Premier mois à 2,99&nbsp;€</h1>
          <p className="card-text">
            Scanner fait partie de l'abonnement, qui débloque aussi la lecture sur le site
            et tes cartes. Le premier mois à 2,99&nbsp;€ est réservé aux nouveaux comptes.
          </p>
          <button className="btn btn-primary" onClick={() => open('/pricing')}>
            Voir les formules
          </button>
          <button className="btn btn-quiet" onClick={() => void check()} disabled={checking}>
            {checking ? <><Spinner />Vérification…</> : 'Déjà abonné ? Actualiser'}
          </button>
          {access?.email ? <p className="card-foot">Connecté en tant que {access.email}</p> : null}
        </section>
      ) : reason ? (
        <section className="card" aria-labelledby="state-title">
          <h1 id="state-title" className="card-title">Hors connexion</h1>
          <p className="card-text">
            Impossible de joindre Dokhae pour vérifier ton abonnement. Vérifie ta connexion,
            puis réessaie.
          </p>
          <button className="btn btn-quiet" onClick={() => void check()} disabled={checking}>
            {checking ? <><Spinner />Vérification…</> : 'Réessayer'}
          </button>
        </section>
      ) : (
        <>
          {/* Text already selected is the clearer intent: it goes first. */}
          {selection ? (
            <div className="selection">
              <button
                className="btn btn-primary btn-big"
                onClick={analyzeSelection}
                disabled={busy}
              >
                {status === 'analyzing' ? <><Spinner />Ouverture…</> : <><TextIcon />Analyser la sélection</>}
              </button>
              <p className="selection-text" lang="ko" title={selection.text}>
                «&nbsp;{selection.text}&nbsp;»
              </p>
            </div>
          ) : null}
          <button
            className={'btn ' + (selection ? 'btn-quiet' : 'btn-primary btn-big')}
            onClick={startScan}
            disabled={busy}
          >
            {status === 'activating' ? <><Spinner />Ouverture…</> : <><ScanIcon />Scanner une bulle</>}
          </button>
          {selection ? null : (
            <p className="or">
              ou sélectionne du coréen dans la page, puis rouvre Dokhae ou fais clic
              droit, «&nbsp;Analyser avec Dokhae&nbsp;»
            </p>
          )}

          {status === 'error' && <div className="error" role="alert">{error}</div>}

          <ol className="steps">
            <li><span>1</span>Ouvre un webtoon</li>
            <li><span>2</span>Encadre une bulle</li>
            <li><span>3</span>Clique un mot, garde-le dans ton deck</li>
          </ol>

          <p className="account" role="status">
            {checking && !access ? (
              <><Spinner />Vérification du compte…</>
            ) : access?.email ? (
              <><span className="dot-ok" aria-hidden="true" /><span className="account-email">{access.email}</span></>
            ) : null}
          </p>
        </>
      )}

      <footer className="bottom">
        <button className="btn-link" onClick={openOptions}>Réglages</button>
        <span aria-hidden="true">·</span>
        <button className="btn-link" onClick={() => open('/deck')}>Mon deck</button>
      </footer>
    </div>
  );
}
