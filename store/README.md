# Store kit

Everything needed to publish Dokhae on the Chrome Web Store and on
addons.mozilla.org (Firefox). Both packages come from one build.

| File | What |
|---|---|
| `listing-fr.md` | Listing in French (default language): descriptions, category, single purpose, permission justifications, privacy tab answers, links |
| `listing-en.md` | The same in English (secondary language) |
| `assets/` | Icon 128, five 1280 × 800 screenshots, small promo tile 440 × 280 |

## Build the package

```sh
npm ci
WXT_SITE_URL=https://dokhae.fr npm run zip
```

This writes `.output/dokhae-extension-<version>-chrome.zip`, `-firefox.zip`
and `-sources.zip` (the packages are about 15 MB, most of it the Korean OCR
model). `npm run zip` sets `SORI_RELEASE`, so the build
refuses a localhost `WXT_SITE_URL`. Never set `SORI_SCREENSHOTS` for a
release: it adds `<all_urls>`.

Before uploading, check `.output/chrome-mv3/manifest.json` (and the same in
`.output/firefox-mv3/`):

- `name` Dokhae, `version` bumped (the store refuses a version it has seen),
- `host_permissions` ends with `https://dokhae.fr/*` and holds no
  `localhost:3000` and no `<all_urls>`,
- `content_scripts` has only `https://dokhae.fr/connect-extension*`.

For an update, bump `version` in both `wxt.config.ts` and `package.json`.

## Screenshots

`store/shoot.mjs` regenerates the five screenshots and the promo tile: it
drives the real extension on Odin's webtoon page, then lays each frame out at
1280 × 800 (Dok's mark, title, subtitle) with the site's fonts. With the
local site running:

```sh
WXT_SITE_URL=http://localhost:3000 SORI_SCREENSHOTS=1 npm run build
SORI_TOKEN=sori_… NODE_PATH=<dir with playwright-core> node store/shoot.mjs
WXT_SITE_URL=http://localhost:3000 npm run build   # never ship the screenshot build
```

Titles and subtitles live in the script. The site's own product shots come
from its `scripts/screenshots/shoot.mjs`.

## By hand in the dashboard

1. Upload the zip (Package), then fill Store listing from `listing-fr.md`;
   add English from `listing-en.md`.
2. Privacy tab: single purpose, one justification per permission and host,
   remote code "No", the data boxes and the three certifications.
3. Privacy policy URL `https://dokhae.fr/privacy`, support email
   `contact@dokhae.fr`, website `https://dokhae.fr` (verify the domain in
   Search Console to show it as the official site).
4. Account: trader declaration (EU), since Dokhae is sold by a
   micro-entreprise; the declared address and email are shown publicly.
5. Distribution: public, all regions (or French-speaking ones first).

## Firefox (addons.mozilla.org)

1. Create a developer account at https://addons.mozilla.org/developers/
   (a Firefox account, no fee).
2. Build as above, then check `.output/firefox-mv3/manifest.json`: the same
   points as Chrome, plus `browser_specific_settings.gecko.id` is
   `extension@dokhae.fr` (never change it: AMO ties the listing and updates to
   it) and `data_collection_permissions` lists `websiteContent` and
   `authenticationInfo`.
3. `npm run lint:firefox`: Mozilla's own validator must report 0 errors. The
   warnings about `innerHTML` (the panel, whose text is escaped by `esc()` in
   `entrypoints/content.ts`) and the `Function` constructor (inside Tesseract)
   are expected; say so in the notes to the reviewer.
4. **Submit a New Add-on**, "On this site" (listed), upload
   `dokhae-extension-<version>-firefox.zip`, and when asked for source code,
   upload `-sources.zip`. The build steps are in `SOURCES.md` at its root.
5. Listing: reuse `listing-fr.md` (description, category "Language support"
   or "Education"), the screenshots in `assets/`, and the privacy policy
   https://dokhae.fr/privacy. Tick Firefox for Android too: the manifest
   declares it.
6. Review is automatic, sometimes followed by a manual check of a few days.
   Updates: bump `version` in `wxt.config.ts` and `package.json`, rebuild,
   upload the new pair of zips.
