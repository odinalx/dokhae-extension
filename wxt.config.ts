import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';

// The site origin must be a compile-time host permission, and this config file
// runs before WXT exposes .env values — so read it ourselves:
// process.env → .env file → localhost fallback. Keep in sync with
// src/config.ts, which reads the same variable via import.meta.env.
function siteOrigin(): string {
  let url = process.env.WXT_SITE_URL;
  if (!url) {
    try {
      const env = readFileSync(new URL('.env', import.meta.url), 'utf8');
      url = /^WXT_SITE_URL=(.+)$/m.exec(env)?.[1]?.trim();
    } catch {
      // no .env file — use the fallback
    }
  }
  const origin = new URL(url || 'http://localhost:3000').origin;

  // The origin is baked into the bundle AND into host_permissions, so a release
  // that kept the committed localhost default would ship an extension talking
  // to the user's own machine — failing silently, with no permission to reach
  // the real site. `npm run zip` sets SORI_RELEASE, so the check guards the
  // distributable without breaking `npm run build` against a local server.
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(origin);
  if (isLocal && process.env.SORI_RELEASE) {
    throw new Error(
      `WXT_SITE_URL is ${origin} but this is a release build. ` +
        'Set WXT_SITE_URL to the real site origin (https://…) and rebuild.'
    );
  }
  return origin;
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // WXT builds Firefox as MV2 unless told otherwise; both stores get MV3.
  manifestVersion: 3,
  vite: () => ({
    define: {
      // See src/globals.d.ts.
      __SORI_SCREENSHOTS__: JSON.stringify(Boolean(process.env.SORI_SCREENSHOTS)),
      __DOKHAE_SITE_ORIGIN__: JSON.stringify(siteOrigin()),
    },
  }),
  // One manifest for both stores: `wxt build` makes Chrome's, `wxt build -b
  // firefox` Firefox's. Only what differs depends on `browser`.
  manifest: ({ browser }) => ({
    name: 'Dokhae',
    description: "Lis tes webtoons en coréen\u00a0: capture une bulle, comprends chaque mot, garde-les dans ton deck Dokhae.",
    version: '1.3.0',
    homepage_url: siteOrigin(),
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              // Fixed id: AMO ties the listing, updates and the storage of an
              // installed copy to it.
              id: 'extension@dokhae.fr',
              // First version that reads data_collection_permissions.
              strict_min_version: '140.0',
              // Declared to Mozilla and shown at install: the text of a scanned
              // bubble or a selection goes to the Dokhae server for analysis,
              // and the extension holds the account's sign-in token.
              data_collection_permissions: { required: ['websiteContent', 'authenticationInfo'] },
            },
            gecko_android: { strict_min_version: '142.0' },
          },
        }
      : {
          // chrome.runtime.getContexts (the offscreen document check) is Chrome 116+.
          minimum_chrome_version: '116',
        }),
    // Tesseract compiles a .wasm core; MV3's default CSP (script-src 'self')
    // blocks WebAssembly.instantiate. 'wasm-unsafe-eval' re-allows it.
    // (The sandbox entry that used to sit here existed only for Kiwi, whose
    // Emscripten glue needs 'unsafe-eval'. Segmentation now runs on the Dokhae
    // server, so neither the sandbox nor that CSP relaxation is needed.)
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // No 'tabs': nothing reads a tab's URL or title, and it adds a
    // "browsing history" warning at install.
    // 'offscreen' is Chrome's way to run OCR and audio outside its service
    // worker; Firefox's background page does both itself (src/engine).
    permissions: [
      'activeTab',
      'scripting',
      'storage',
      ...(browser === 'firefox' ? [] : ['offscreen']),
      'contextMenus',
    ],
    host_permissions: [
      // Pronunciation: Google TTS is the fallback voice (translation itself
      // moved to the Dokhae server)...
      'https://translate.google.com/*',
      // ...after the Naver dictionary's recorded word audio (page, then file).
      'https://ko.dict.naver.com/*',
      'https://dict-dn.pstatic.net/*',
      // AnkiConnect on the reader's own machine, for the "Anki" destination.
      'http://127.0.0.1:8765/*',
      'http://localhost:8765/*',
      // (No *.apigw.ntruss.com: Clova Voice settings are hidden in the options
      // page, so nobody can enter keys, and without the permission a leftover
      // key just falls back to Google TTS.)
      // Dokhae website API (account check + saving flashcards).
      `${siteOrigin()}/*`,
      // Screenshot builds only (the site's scripts/screenshots/shoot.mjs):
      // automation can't click the toolbar button, so it never gets
      // activeTab, and captureVisibleTab then needs <all_urls>. Never set
      // SORI_SCREENSHOTS for a release.
      ...(process.env.SORI_SCREENSHOTS ? ['<all_urls>'] : []),
    ],
    // No web_accessible_resources: the Tesseract worker, core and model are
    // loaded by the offscreen document, which is already on the extension
    // origin. Exposing them to every page only let sites fingerprint Dokhae.
  }),
});
