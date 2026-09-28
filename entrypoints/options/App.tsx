import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, type ExtensionMessage, type Settings } from '../../src/types';
import { getSettings, saveSettings, hasVoiceCreds, setSiteToken, TOKEN_KEY } from '../../src/settings';
import { fetchDecks, logoutDevice, revokedMessage, type SiteDeck } from '../../src/site';
import { clearAccessCache } from '../../src/access';
import { SITE_URL } from '../../src/config';
import { CONNECT_PATH } from '../../src/connect';

interface AccessView {
  ok: boolean;
  reason?: string;
  email?: string;
  plan?: string;
  revokedReason?: string;
}

const PLAN_NAMES: Record<string, string> = {
  monthly: 'mensuel',
  yearly: 'annuel',
  lifetime: 'à vie',
};

const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '');

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [access, setAccess] = useState<AccessView | null>(null);
  const [checking, setChecking] = useState(true);
  // The token as stored: the deck list is fetched with it. Only the connect
  // page and the rotation in fetchAccount write it, never this page's save.
  const [savedToken, setSavedToken] = useState('');
  const savedTokenRef = useRef('');
  savedTokenRef.current = savedToken;

  const refreshAccess = useCallback(async (force: boolean) => {
    setChecking(true);
    try {
      const resp = (await browser.runtime.sendMessage({
        type: 'ACCESS_CHECK', force,
      } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
      if (resp && resp.type === 'ACCESS_INFO') {
        setAccess({
          ok: resp.ok, reason: resp.reason, email: resp.email, plan: resp.plan,
          revokedReason: resp.revokedReason,
        });
      }
    } catch {
      setAccess(null);
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setSavedToken(s.siteToken);
    });
    void refreshAccess(false);

    // Connecting happens in a site tab: pick the new token up without a
    // reload, and without touching the other fields someone may be editing.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes[TOKEN_KEY]) return;
      const token = String(changes[TOKEN_KEY].newValue ?? '');
      if (token === savedTokenRef.current) return;
      savedTokenRef.current = token;
      setSavedToken(token);
      setSettings((s) => ({ ...s, siteToken: token }));
      void refreshAccess(true);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refreshAccess]);

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setSaved(false);
  };

  const onSave = async () => {
    await saveSettings(settings);
    setSaved(true);
  };

  const onDisconnect = async () => {
    // Ends the token on the site too, which frees this browser's place on the
    // account. Offline, it is still forgotten here.
    const token = savedTokenRef.current;
    if (token) await logoutDevice(token).catch(() => {});
    await setSiteToken('');
    await clearAccessCache();
    setSettings((s) => ({ ...s, siteToken: '' }));
    setSavedToken('');
    savedTokenRef.current = '';
    void refreshAccess(true);
  };

  const connected = Boolean(access?.ok || access?.reason === 'not-subscribed');

  return (
    <div className="page">
      <header className="page-head">
        <span className="eyebrow">Dokhae · 독해</span>
        <h1>Réglages</h1>
        <p className="lead">
          Relie l’extension à ton compte Dokhae. Les mots que tu captures vont
          dans ton deck Dokhae (ou dans Anki, si tu préfères).
        </p>
      </header>

      <section aria-labelledby="account-title">
        <div className="sec-head">
          <h2 id="account-title">Compte Dokhae</h2>
          <AccessBadge access={access} checking={checking} />
        </div>

        {connected && access ? (
          <>
            <div className="account-row">
              <div className="account-id">
                <span className="field-label">Connecté en tant que</span>
                <strong>{access.email || 'compte Dokhae'}</strong>
              </div>
              {access.ok && access.plan ? (
                <span className="badge on">Formule {PLAN_NAMES[access.plan] ?? access.plan}</span>
              ) : null}
            </div>
            {access.reason === 'not-subscribed' && (
              <div className="notice">
                <p>
                  Scanner fait partie de l’abonnement Dokhae. Pour un nouveau compte, le
                  premier mois est à 2,99{NB}€.
                </p>
                <div className="actions">
                  <a className="btn btn-primary" href={`${SITE_URL}/pricing`} target="_blank" rel="noreferrer">
                    Voir les formules
                  </a>
                  <button className="btn btn-quiet" onClick={() => void refreshAccess(true)} disabled={checking}>
                    {checking ? 'Vérification…' : `Déjà abonné${NB}? Actualiser`}
                  </button>
                </div>
              </div>
            )}
            <div className="actions">
              <a className="btn btn-quiet" href={`${SITE_URL}${CONNECT_PATH}`} target="_blank" rel="noreferrer">
                Changer de compte
              </a>
              <button className="btn btn-quiet btn-danger" onClick={() => void onDisconnect()}>
                Déconnecter
              </button>
            </div>
          </>
        ) : (
          <>
            {access?.reason === 'offline' ? (
              <div className="notice warn-hint" role="alert">
                <p>Impossible de joindre {SITE_HOST} pour vérifier ton compte. Vérifie ta connexion.</p>
                <div className="actions">
                  <button className="btn btn-quiet" onClick={() => void refreshAccess(true)} disabled={checking}>
                    {checking ? 'Vérification…' : 'Réessayer'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {access?.reason === 'invalid-token' && (
                  <p className="hint warn-hint" role="alert">
                    {access.revokedReason
                      ? revokedMessage(access.revokedReason)
                      : 'Ton accès a expiré ou a été révoqué. Reconnecte l’extension.'}
                  </p>
                )}
                <p className="hint">
                  Un clic suffit{NB}: {SITE_HOST} s’ouvre dans un onglet et relie l’extension
                  à ton compte. Pas encore de compte{NB}? Tu pourras le créer au passage.
                </p>
                <div className="actions">
                  <a
                    className="btn btn-primary"
                    href={`${SITE_URL}${CONNECT_PATH}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Connecter mon compte
                  </a>
                  <a className="btn btn-quiet" href={`${SITE_URL}/extension`} target="_blank" rel="noreferrer">
                    Comment ça marche{NB}?
                  </a>
                </div>
              </>
            )}
          </>
        )}
      </section>

      <section>
        <div className="sec-head">
          <h2>Cartes</h2>
        </div>
        <p className="hint">Où envoyer les mots quand tu cliques sur « Ajouter au deck » ?</p>
        <label className="checkbox">
          <input
            type="radio"
            name="flashcard-target"
            checked={settings.flashcardTarget === 'site'}
            onChange={() => update({ flashcardTarget: 'site' })}
          />
          <span>
            <strong>Site Dokhae</strong> (par défaut)<br />
            Les cartes arrivent dans ton deck en ligne. Révise-les partout sur{' '}
            <a href={`${SITE_URL}/study`} target="_blank" rel="noreferrer">{SITE_URL.replace(/^https?:\/\//, '')}/study</a>.
          </span>
        </label>
        <label className="checkbox">
          <input
            type="radio"
            name="flashcard-target"
            checked={settings.flashcardTarget === 'anki'}
            onChange={() => update({ flashcardTarget: 'anki' })}
          />
          <span>
            <strong>Anki (ordinateur)</strong><br />
            Envoie les cartes dans Anki via le module AnkiConnect.
          </span>
        </label>

        {settings.flashcardTarget === 'site' && (
          <DeckPicker
            token={savedToken}
            value={settings.soriDeckId}
            onChange={(soriDeckId) => update({ soriDeckId })}
          />
        )}
      </section>

      {settings.flashcardTarget === 'anki' && (
        <section>
          <div className="sec-head">
            <h2>Configuration d’Anki</h2>
            <span className="badge on">AnkiConnect</span>
          </div>
          <p className="hint">
            Anki doit être ouvert sur ton ordinateur avec le module gratuit{' '}
            <a href="https://ankiweb.net/shared/info/2055492159" target="_blank" rel="noreferrer">
              AnkiConnect
            </a>. <strong>À faire une seule fois :</strong> dans Anki, ouvre{' '}
            <em>Outils → Modules → AnkiConnect → Configuration</em> et ajoute l’origine
            de l’extension à <code>webCorsOriginList</code> :
          </p>
          <pre className="origin-box">
{`"webCorsOriginList": [
    "http://localhost",
    "${extensionOrigin}"
]`}
          </pre>
          <label>
            <span className="field-label">Adresse d’AnkiConnect</span>
            <input
              type="text"
              placeholder="http://127.0.0.1:8765"
              value={settings.ankiConnectUrl}
              onChange={(e) => update({ ankiConnectUrl: e.target.value })}
            />
          </label>
          <label>
            <span className="field-label">Nom du deck</span>
            <input
              type="text"
              placeholder="Dokhae"
              value={settings.ankiDeck}
              onChange={(e) => update({ ankiDeck: e.target.value })}
            />
            <span className="field-hint">
              Les cartes utilisent un type de note « Korean Reader » que l’extension crée
              toute seule (mot, traduction, son, 4 dictionnaires, phrase d’exemple).
            </span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.ankiAutoSend}
              onChange={(e) => update({ ankiAutoSend: e.target.checked })}
            />
            <span>
              Envoyer chaque carte à Anki tout de suite (sinon elles attendent dans une file
              que tu vides avec « Tout envoyer vers Anki »).
            </span>
          </label>
        </section>
      )}

      {SHOW_NAVER_CLOUD && (<>
      <section>
        <div className="sec-head">
          <h2>Clova Voice (prononciation)</h2>
          <span className={hasVoiceCreds(settings) ? 'badge on' : 'badge'}>
            {hasVoiceCreds(settings) ? 'active' : 'Google TTS utilisé'}
          </span>
        </div>
        <p className="hint">
          Naver Cloud → Services → <strong>Clova Voice (Premium)</strong>. Enregistre une
          application, puis copie son <em>API Key ID</em> et son <em>API Key</em>.
        </p>
        <label>
          <span className="field-label">API Key ID</span>
          <input
            type="text"
            placeholder="X-NCP-APIGW-API-KEY-ID"
            value={settings.voiceApiKeyId}
            onChange={(e) => update({ voiceApiKeyId: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">API Key</span>
          <input
            type="password"
            placeholder="X-NCP-APIGW-API-KEY"
            value={settings.voiceApiKey}
            onChange={(e) => update({ voiceApiKey: e.target.value })}
          />
        </label>
        <label>
          <span className="field-label">Voix</span>
          <select
            value={settings.voiceSpeaker}
            onChange={(e) => update({ voiceSpeaker: e.target.value })}
          >
            <option value="nara">nara (féminine)</option>
            <option value="nminyoung">nminyoung (féminine)</option>
            <option value="nyejin">nyejin (féminine)</option>
            <option value="njihun">njihun (masculine)</option>
            <option value="njinho">njinho (masculine)</option>
          </select>
        </label>
      </section>
      </>)}

      <div className="actions">
        <button className="btn btn-primary" onClick={onSave}>Enregistrer</button>
        {saved && <span className="saved-note" role="status">Réglages enregistrés</span>}
      </div>
    </div>
  );
}

function AccessBadge({ access, checking }: { access: AccessView | null; checking: boolean }) {
  if (checking) return <span className="badge" role="status">Vérification…</span>;
  if (!access) return <span className="badge">État inconnu</span>;
  if (access.ok) return <span className="badge ok">Connecté</span>;
  const label =
    access.reason === 'not-subscribed' ? 'Sans abonnement'
    : access.reason === 'offline' ? 'Hors connexion'
    : access.reason === 'invalid-token' ? 'Accès expiré'
    : 'Non connecté';
  return <span className="badge locked">{label}</span>;
}

/**
 * Which Dokhae deck captured words land in.
 *
 * The decks are the site's, so they're fetched rather than typed: a name typed
 * here would create nothing and file words nowhere. The list reloads whenever
 * the saved token changes, since without a valid token there is nothing to ask.
 */
function DeckPicker({
  token,
  value,
  onChange,
}: {
  token: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [decks, setDecks] = useState<SiteDeck[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const clean = token.trim();
    if (!clean) {
      setDecks(null);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setDecks(await fetchDecks(clean));
    } catch (e) {
      setDecks(null);
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // A deck deleted on the site would otherwise fail silently: the server falls
  // back to the first deck, and words would quietly pile up somewhere else.
  const missing = Boolean(value) && decks !== null && !decks.some((d) => d.id === value);

  return (
    <label>
      <span className="field-label">Deck</span>
      <select
        value={missing ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading || decks === null}
      >
        <option value="">
          {decks === null ? 'Connecte d’abord ton compte' : 'Premier deck (par défaut)'}
        </option>
        {(decks ?? []).map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} ({d.count})
          </option>
        ))}
      </select>
      <span className="field-hint">
        {error
          ? `Impossible de charger tes decks${NB}: ${error}`
          : missing
            ? 'Le deck choisi n’existe plus. Les mots vont dans ton premier deck jusqu’à ce que tu en choisisses un autre.'
            : (
              <>
                Crée et renomme tes decks sur{' '}
                <a href={`${SITE_URL}/deck`} target="_blank" rel="noreferrer">
                  ta page deck
                </a>
                .{' '}
                <button type="button" className="linkish" onClick={() => void load()}>
                  Recharger
                </button>
              </>
            )}
      </span>
    </label>
  );
}

const NB = '\u00a0';

// chrome-extension://<id> on Chrome, moz-extension://<uuid> on Firefox.
const extensionOrigin = new URL(chrome.runtime.getURL('/')).origin;

// Naver Clova Voice settings are set aside for now: the code stays but the UI
// is hidden. Flip to true to bring the section back.
const SHOW_NAVER_CLOUD = false;
