import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { SITE_URL } from '../../src/config';
import { CONNECT_PATH } from '../../src/connect';
import { requestSiteAccess } from '../../src/permissions';
import '../popup/style.css';

/**
 * Opened after install when the browser (Firefox) has not granted site access
 * yet: one click to allow it, then on to connecting the account, as Chrome
 * readers get straight away.
 */
function Grant() {
  const [refused, setRefused] = useState(false);

  const allow = () => {
    // Straight from the click: the prompt may only open on a user gesture.
    requestSiteAccess()
      .then((ok) => {
        if (ok) window.location.href = `${SITE_URL}${CONNECT_PATH}?welcome=1`;
        else setRefused(true);
      })
      .catch(() => setRefused(true));
  };

  return (
    <main className="app grant">
      <div className="brand">
        <img src="/icon/logo.svg" width={34} height={34} alt="" aria-hidden="true" />
        <span className="brand-name">Dokhae</span>
      </div>
      <section className="card">
        <h1 className="card-title">Une autorisation avant de commencer</h1>
        <p className="card-text">
          Dokhae a besoin de contacter dokhae.fr (ton compte et l’analyse des mots) et les
          dictionnaires de prononciation. Ton navigateur te demande ton accord une seule fois.
        </p>
        <button className="btn btn-primary" onClick={allow}>
          Autoriser et connecter mon compte
        </button>
        {refused ? (
          <p className="card-foot">
            Sans cette autorisation, Dokhae ne peut rien lire. Tu peux la donner plus tard
            depuis l’icône Dokhae.
          </p>
        ) : null}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Grant />
  </React.StrictMode>
);
