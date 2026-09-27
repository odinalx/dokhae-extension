# Dokhae (독해), browser extension

> **Dokhae : apprends le coréen en lisant tes webtoons préférés, ou même tes romans.**

A Chrome/Chromium extension (Manifest V3, version 1.0.0) for reading Korean
webtoons. Drag a box over a speech bubble and it:

- **reads** the Korean with Tesseract, locally, on your machine,
- **analyses** it on the Dokhae server: sentence translation, the sentence split
  into words **colored by part of speech**, and for each word its meaning,
  dictionary form, register and grammar notes, in French,
- **pronounces** words and sentences,
- **saves** the words you pick to your Dokhae deck on https://dokhae.fr (or,
  if you prefer, sends them to Anki).

The interface is in French. It is the browser client of the
[Dokhae website](../site), which also serves the mobile app.

> **Requires a Dokhae subscription.** There is no free tier. The extension
> checks its account token with `GET /api/me` and stays locked until the
> account has an active plan (the first month is 2,99 €, see `/pricing` on the
> site).

## Contents

- [Connect your account](#connect-your-account)
- [How to use](#how-to-use)
- [How it works](#how-it-works)
- [Build and install](#build-and-install)
- [Publishing on the Chrome Web Store](#publishing-on-the-chrome-web-store)
- [Anki (optional)](#anki-optional)
- [Technology](#technology)

## Connect your account

1. Create an account on https://dokhae.fr and subscribe.
2. Installing the extension opens `/connect-extension?welcome=1`; later, the
   **Connecter mon compte** button in the popup or the settings page opens
   `/connect-extension`. One click there connects this browser as a device of
   the account and hands its token to the extension. The whole exchange is
   specified in [docs/connect-extension.md](docs/connect-extension.md): a
   content script runs on that one page only, announces itself (with this
   install's id) in `DOKHAE_PRESENT`, receives the token in `DOKHAE_CONNECT`
   and answers `DOKHAE_CONNECTED`.

There is no way to paste a token by hand any more. An account holds two
browsers and one phone; the token rotates once a day through `GET /api/me`
(`src/site.ts`, `fetchAccount`) and lives under its own storage key so no
settings save can write an old one back (`src/settings.ts`). Using a replaced
token after its grace period disconnects the device: that is what a copied
token looks like. **Déconnecter** in the settings revokes the token on the
site too.

The verdict of `GET /api/me` is cached for 10 minutes, and a previously
unlocked extension stays usable for 24 hours without a connection so a flaky
network does not lock you out mid-chapter.

If your account has several decks, pick the one captures go to in the settings.
The list comes from the site (`GET /api/decks`), so decks are created and
renamed there. Without a choice, words land in your first deck.

## How to use

1. Open a webtoon page (e.g. comic.naver.com). Chrome cannot capture
   `chrome://` pages, the Web Store or PDFs.
2. Click the Dokhae toolbar icon, then **Scanner une bulle**. The cursor
   becomes a crosshair.
3. Drag a rectangle over one speech bubble. Tighter crops read better.
4. Read the result in the panel (draggable by its header): the sentence with
   each word colored by part of speech, a translation toggle, and a button to
   hear the sentence.
5. Click a word for its meaning, part of speech, dictionary form, register,
   pronunciation and a Naver dictionary link, then **Ajouter au deck**. With
   the Dokhae deck as destination the word is saved at once; if saving fails
   it stays queued and leaves with **Tout envoyer** at the bottom of the panel.
6. **Scanner une autre bulle** starts the next capture without reopening the
   popup.

Selected text works too: right-click a Korean selection and choose
**Analyser « … » avec Dokhae** to get the same panel without capture or OCR.

## How it works

1. **Capture (background + content script).** No content script is declared
   for arbitrary pages. Clicking the popup button (or the context menu entry)
   grants `activeTab`, and the background injects the panel into that tab
   only. The background screenshots the visible tab, crops it to your box and
   prepares it for OCR in one canvas pass (`src/ocrPrep.ts`): Otsu threshold,
   light-on-dark text inverted, every dark region touching the frame (bubble
   outline, panel edges) erased, and a white margin added.
2. **OCR (offscreen document).** Tesseract.js runs with the Korean `best`
   model in an offscreen document, which lives on the extension origin where
   the worker is allowed. The worker, wasm core and model are bundled, so
   recognition needs no network and site CSPs cannot block it. Besides the
   text, it reports which syllables it read with low confidence.
3. **Analysis (Dokhae server).** The text goes to `POST /api/analyze` with
   `lang: "fr"` and the low-confidence offsets as `uncertain`. The server
   restores syllables Tesseract's Korean model cannot output (Kiwi scores the
   candidates), segments the sentence with Kiwi, translates it, and returns
   each word with its gloss, part of speech and dictionary form.
4. **Render (content script).** The panel is plain DOM inside a Shadow DOM, so
   page styles cannot leak in. Part-of-speech colors are the same as on the
   site's deck (`POS_COLORS` in `entrypoints/content.ts`).

**Pronunciation** tries the Naver dictionary's recorded audio for a single
word, then Google TTS, and plays from the offscreen document.

## Build and install

Requires Node.js 18+.

```sh
npm install        # postinstall copies Tesseract assets and downloads the Korean model
cp .env.example .env   # WXT_SITE_URL, the site origin baked into the build
npm run dev        # Chromium with the extension and live reload
npm run build      # .output/chrome-mv3/
npm test
npm run typecheck
```

`WXT_SITE_URL` (from the environment or `.env`, default
`http://localhost:3000`) becomes both the API origin and a host permission, so
build against the site you want to talk to. To try a build, open
`chrome://extensions`, turn on Developer mode, **Load unpacked** and pick
`.output/chrome-mv3`. After a rebuild, click the reload icon on the extension's
card.

Release package:

```sh
WXT_SITE_URL=https://dokhae.fr npm run zip
# → .output/dokhae-extension-1.0.0-chrome.zip
```

`npm run zip` sets `SORI_RELEASE`, which makes the build refuse a localhost
origin. Never set `SORI_SCREENSHOTS` for a release: it is only for the site's
screenshot script and adds `<all_urls>`. For an update, bump `version` in both
`wxt.config.ts` and `package.json`.

## Publishing on the Chrome Web Store

Everything for the listing is in [`store/`](store/README.md): French and
English descriptions, permission justifications, privacy answers,
screenshots and promo tile, plus the checks to run on the built
`manifest.json` before uploading.

## Anki (optional)

Anki is the alternative destination, chosen in the settings. Cards go through
the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on and
wait in a queue until **Tout envoyer** (or immediately, if you turn that on).

1. In desktop Anki, install AnkiConnect (code `2055492159`) and restart.
2. The extension's settings page shows its `chrome-extension://<id>` origin.
   Add it to `webCorsOriginList` in AnkiConnect's config:
   ```json
   "webCorsOriginList": ["http://localhost", "chrome-extension://<your-id>"]
   ```
3. Keep Anki open while sending.

The extension creates a **Korean Reader** note type: the word on the front;
meaning, word audio, dictionary links and the example sentence with its audio
and translation on the back. The cards use the Nanum fonts; if your profile
lacks them, drop `_NanumGothic-Regular.ttf`, `_NanumMyeongjo-Regular.ttf` and
`_NanumPenScript-Regular.ttf` into `collection.media`.

## Technology

| Area | Choice |
| --- | --- |
| Framework | [WXT](https://wxt.dev/), MV3, TypeScript |
| UI | React for the popup and settings; vanilla DOM in a Shadow DOM for the in-page panel |
| OCR | Tesseract.js v5, `kor` `best` model, in an offscreen document |
| Analysis | Dokhae API, `POST /api/analyze` (Kiwi, translation, grammar) |
| Account | Dokhae API, `GET /api/me`; token from `/connect-extension` |
| Flashcards | Dokhae deck (`POST /api/cards`, default) or AnkiConnect |
| Pronunciation | Naver dictionary audio, then Google TTS |
| Permissions | `activeTab`, `scripting`, `storage`, `offscreen`, `contextMenus`; hosts: the site, Naver dictionary audio, Google TTS, AnkiConnect on localhost |

The Clova Voice (Naver Cloud) code path is still in the source, but its
settings are hidden (`SHOW_NAVER_CLOUD = false` in
`entrypoints/options/App.tsx`) and the manifest no longer requests its host,
so released builds never use it.
