# Dokhae (독해), browser extension

> **Dokhae : apprends le coréen en lisant tes webtoons préférés, ou même tes romans.**

A browser extension for Chrome/Chromium and Firefox (Manifest V3) for reading
Korean webtoons, built for both from the same source. Drag a box over a speech bubble and it:

- **reads** the Korean with Tesseract, locally, on your machine,
- **analyses** it on the Dokhae server: sentence translation, the sentence split
  into words **colored by part of speech**, and for each word its meaning,
  dictionary form, register and grammar notes, in French,
- **pronounces** words and sentences,
- **saves** the words you pick to your Dokhae deck on https://dokhae.fr (or,
  if you prefer, sends them to Anki).

On Netflix, YouTube, Viki, Disney+ and Prime Video it also turns Korean
subtitles into clickable, analysed lines (see
[Netflix subtitles](#netflix-subtitles),
[YouTube subtitles](#youtube-subtitles) and
[Viki, Disney+ and Prime Video subtitles](#viki-disney-and-prime-video-subtitles)).

The interface is in French. It is the browser client of the
[Dokhae website](../site), which also serves the mobile app.

> **Free to try, unlimited with a plan.** Any Dokhae account can connect the
> extension: without a plan it gets 5 analyses a day (counted by the site, see
> [Free analyses](#free-analyses)) and can save words, which go to its
> Parcours deck. A plan removes the limit (the first month is 2,99 € for an
> account that never paid, see `/pricing` on the site).

## Contents

- [Connect your account](#connect-your-account)
- [How to use](#how-to-use)
- [Netflix subtitles](#netflix-subtitles)
- [YouTube subtitles](#youtube-subtitles)
- [Viki, Disney+ and Prime Video subtitles](#viki-disney-and-prime-video-subtitles)
- [Requests to the site](#requests-to-the-site)
- [How it works](#how-it-works)
- [Build and install](#build-and-install)
- [Publishing](#publishing)
- [Anki (optional)](#anki-optional)
- [Technology](#technology)

## Connect your account

1. Create an account on https://dokhae.fr (a plan is optional, see
   [Free analyses](#free-analyses)).
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

### Free analyses

An account without a plan gets 5 analyses a day, counted by the site (its
`src/server/quota.ts`) and reset at midnight UTC:

- `GET /api/me` returns `freeAnalysesLeft` and `freeAnalysesPerDay`; the
  popup shows "X/5 analyses gratuites aujourd'hui" and the settings page the
  same count.
- A scan or a selection spends one. Once they are spent, `POST /api/analyze`
  answers `free_limit_reached`, and the cached access becomes `free-limit`
  (`src/access.ts`, wording in `src/freeLimit.ts`): scans are refused without
  a request until the next UTC day, with the plans offered.
- Video lines are sent with `kind: "line"` and cost nothing. Opening a word
  under a video spends one (`POST /api/free/word`, `spendFreeWord` in
  `src/site.ts`, called by `openWord` in `src/video/player.ts`); a word
  opened again on the same line is not counted twice.
- Saving words stays open to free accounts, even once the day's analyses are
  spent (`deckLock`): their words go to their Parcours deck.

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

## Netflix subtitles

On `https://www.netflix.com/watch/…`, with Korean subtitles chosen in the
player, Dokhae hides the player's line and draws its own in the same place
(fullscreen included): the line analysed by `POST /api/analyze`, each word
underlined in its part-of-speech colour. Lines in another language are left
alone.

- **Click a word**: the video pauses and the usual panel opens on that word's
  card (meaning, dictionary form, ending, register, other senses).
  **Ajouter au deck** saves it with the whole subtitle line as the example
  and its translation, source `Netflix · <title shown by the player>`, and a
  link back to the moment (`/watch/<id>?t=<seconds>`). Closing the panel
  resumes playback.
- **Keys while watching** (none of them is a Netflix shortcut; ignored with
  Ctrl, Alt or Cmd, and until a Korean line has been seen):
  `A` previous line, `R` replay the line, `T` show or hide the translation,
  `P` pause at the end of each line.
- **Settings**: "Sous-titres Netflix interactifs" (on by default) and
  "Pause à la fin de chaque réplique" (off by default), in the settings page.
- **Locked account** (not connected, or a free account whose analyses are
  spent): the line shows as is, with the usual message and
  **Connecter mon compte** or **Voir les formules**.

How it is built:

- The player itself is shared with the other video sites:
  `src/video/player.ts` (overlay, analysis, panel, keys, auto-pause) drives a
  `SubtitleSite` adapter (`src/video/site.ts`); Netflix's is
  `src/netflix/site.ts`.
- `entrypoints/netflix.content.ts` is declared for all of
  `https://www.netflix.com/*`, because Netflix is a single-page app (going
  from the catalogue to a title loads no new page), and idles outside
  `/watch/`. A `MutationObserver` reads the line once per frame at most,
  and only for mutations of the subtitle layer (the player's clock and
  controls change all the time).
- Every selector lives in `src/netflix/subtitles.ts`
  (`.player-timedtext`, `.player-timedtext-text-container`,
  `[data-uia="video-title"]`, with looser fallbacks). Netflix renames its
  classes from time to time: that file and its tests
  (`src/__tests__/netflixSubtitles.test.ts`) are what to update.
- Only the text on screen is read. Line starts are the `<video>`'s
  `currentTime` when each line appears (`src/video/cues.ts`), which is
  what "previous" and "replay" jump to.
- Seeking goes through Netflix's player API
  (`netflix.appContext.state.playerApp.getAPI().videoPlayer`) from
  `entrypoints/netflix-seek.content.ts`, a few lines in the page's `MAIN`
  world: setting `currentTime` directly crashes Netflix's player (M7375).
- When to ask for a line is `src/video/lines.ts`: a line the tab knows
  costs nothing, the background's persistent cache is asked at once, and
  the site only once the line has stayed 300 ms on screen. The site allows
  120 analyses an hour per account (`hitAnalyzeLimit`), which a series uses
  in 10 to 15 minutes; `src/__tests__/netflixRequests.test.ts` counts what a
  200-line viewing costs. Raising that budget for Netflix is a site-side
  decision.

## YouTube subtitles

On `https://www.youtube.com/watch?v=…` (and `/live/…`), with Korean captions
turned on in the player, the channel's own or the automatic ones, Dokhae
does what it does on Netflix: same overlay, same panel, same keys, same
settings pattern ("Sous-titres YouTube interactifs" on by default, its own
"Pause à la fin de chaque réplique" off by default). Cards get the source
`YouTube · <video title>` and a link `watch?v=<id>&t=<seconds>s`.

What differs from Netflix:

- `T` is also YouTube's theatre mode key; Dokhae takes it only once a Korean
  line has been seen, like the other keys.
- Seeking sets the `<video>`'s `currentTime`, which YouTube's player follows.
- Outside fullscreen the player is a box in a page that scrolls: the overlay
  is centred on `#movie_player`, follows it on scroll and resize, and hides
  when the player leaves the screen.
- **Automatic captions** (`.ytp-caption-window-rollup`) write a line word by
  word and scroll up a row at a time. For those, a line is only sent for
  analysis after 900 ms without a new word, the words already analysed stay
  clickable while the line grows, and growing or scrolling is not the end of
  a line (no auto-pause, and `A`/`R` keep the line's first start).
- Every selector lives in `src/youtube/subtitles.ts`
  (`#ytp-caption-window-container`, `.caption-window`,
  `.caption-visual-line`, `.ytp-caption-segment`); its tests are
  `src/__tests__/youtubeSubtitles.test.ts`. Only the text on screen is read:
  YouTube's caption files need a token only its own player holds.
- Testing note: YouTube serves empty captions to automated browsers, so a
  Playwright run sees the player but no subtitles. Test by hand, or inject a
  caption window in YouTube's markup into the real player.

## Viki, Disney+ and Prime Video subtitles

On `https://www.viki.com/videos/…`, on Disney+ (`https://www.disneyplus.com`,
`/play/…` or `/video/…`) and on Prime Video (`https://www.primevideo.com`, and
only the `/gp/video/*` pages of `www.amazon.fr` and `www.amazon.com`, never
the shop), with Korean subtitles chosen in the player, Dokhae does what it
does on Netflix: same overlay, same panel, same keys. Each site has its pair
of settings, in a "Viki, Disney+, Prime Video" section of the settings page:
`vikiSubtitles`/`vikiAutoPause`, `disneySubtitles`/`disneyAutoPause`,
`primeSubtitles`/`primeAutoPause` (interactive subtitles on by default,
auto-pause off). Cards get the source `Viki · <title>`, `Disney+ · <title>`
or `Prime Video · <title>`.

What differs:

- Each site is one adapter, and every selector lives in it:
  `src/viki/site.ts` (video.js: `.vjs-text-track-display`,
  `.vjs-text-track-cue`), `src/disney/site.ts` (`.TimedTextOverlay`,
  `.hive-subtitle-renderer-*`, the older `.dss-subtitle-renderer-*`,
  `timed-text-override-region`, `.shaka-text-container`) and
  `src/prime/site.ts` (`.atvwebplayersdk-captions-overlay`,
  `.atvwebplayersdk-captions-text`). The content scripts
  (`entrypoints/viki.content.ts`, `disney.content.ts`, `prime.content.ts`)
  only start the shared player with them.
- **Disney+** draws its subtitles inside its web components' shadow roots in
  some versions: the root is also searched in open shadow roots
  (`queryDeep(…, true)` in `src/video/dom.ts`), and since mutations inside a
  shadow root never reach the page's observer, the site is also polled
  (`pollMs: 300`). Its player keeps its own playhead, so seeking goes, like
  Netflix, through a few lines in the page's `MAIN` world:
  `entrypoints/disney-seek.content.ts` (`disney-seek.js`) calls the
  `disney-web-player` element's `mediaPlayer.seek` (in milliseconds), and
  falls back to `currentTime` if that API is gone. The subtitle script sends
  it the target time in a DOM event (`src/disney/bridge.ts`).
- **Prime Video** opens its player over whatever page started it, the home
  page included, without changing the address. So the script runs on every
  matched page: the watch id is the title's id when the address names one
  (`/detail/<id>`, `/dp/<id>`), and `"prime"` otherwise, in which case the
  card links to the site's home. On Amazon only `/gp/video/*` is matched.
  Seeking sets the `<video>`'s `currentTime`, which the player follows.
- **Viki** (video.js) also follows `currentTime`. Neither Viki nor Disney+
  nor Prime Video has a time parameter in its links: the card links to the
  episode or title, not to the moment.
- Tests: `src/__tests__/moreVideoSites.test.ts`.
- Testing note: these three adapters were verified only on frozen DOM in the
  unit tests, with the selectors cross-checked against the video wrappers of
  Firefox's picture-in-picture, which reads the same layers on these sites.
  They have not been tried on the live sites (no accounts). The first real
  session on each should check that the line is found, that `A`/`R` seek,
  and on Disney+ that `mediaPlayer.seek` still exists.

## Requests to the site

Every analysis goes through `src/analyzer.ts` in the background:

- plain text (a selection, a subtitle line) is answered from a persistent
  cache (`src/analysisCache.ts`, IndexedDB, 3000 lines, 30 days), keyed by
  the text with spacing normalised; scans always go to the site, since the
  server may correct their OCR text. Signing out clears it;
- two requests for the same line at once share one call;
- after a 429 the background backs off (2 minutes, doubling up to an hour,
  or the site's `Retry-After`): automatic requests (video lines) wait
  without touching the network, a reader's click still goes through.

`GET /api/me` is shared by concurrent checks and not forced by the popup
for an unlocked account; `POST /api/warm` is skipped when the analyser was
used in the last 5 minutes; "Tout envoyer" sends the queue in one
`POST /api/cards/batch`; pronunciations are kept in memory (40).
- Image-based subtitles (some titles draw their subtitles as pictures) have
  no text to read: Dokhae then leaves the player's line alone.

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
build against the site you want to talk to. `npm run build` builds both
browsers (`build:chrome` and `build:firefox` build one).

- **Chrome:** open `chrome://extensions`, turn on Developer mode, **Load
  unpacked** and pick `.output/chrome-mv3`. After a rebuild, click the reload
  icon on the extension's card.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, **Load Temporary
  Add-on** and pick `.output/firefox-mv3/manifest.json`. `npm run dev:firefox`
  does the same with live reload.

Firefox treats every host as optional, content scripts' included. The
first-run page asks for the required hosts and the video sites
(`www.netflix.com`, `www.youtube.com`, `www.viki.com`, `www.disneyplus.com`,
`www.primevideo.com`, and the `/gp/video/` pages of `www.amazon.fr` and
`www.amazon.com`) in one prompt; if the video sites alone are missing, the
popup and the settings offer a button to allow them (`src/permissions.ts`),
and the rest keeps working.

### One source, two browsers

Everything is shared except how OCR and audio run, which the browsers do
differently: Chrome's background is a service worker, so it hands both to an
offscreen document; Firefox's background page runs them itself. That choice
lives in `src/engine/` (picked at build time from `import.meta.env.FIREFOX`),
and `wxt.config.ts` builds each manifest from one definition. Write a feature
once; only touch `src/engine/` for something the two browsers genuinely do
differently, and build both before merging.

Release package:

```sh
WXT_SITE_URL=https://dokhae.fr npm run zip
# → .output/dokhae-extension-<version>-chrome.zip   (Chrome Web Store)
# → .output/dokhae-extension-<version>-firefox.zip  (addons.mozilla.org)
# → .output/dokhae-extension-<version>-sources.zip  (source for Mozilla's review)
```

`npm run zip` sets `SORI_RELEASE`, which makes the build refuse a localhost
origin. Never set `SORI_SCREENSHOTS` for a release: it is only for the site's
screenshot script and adds `<all_urls>`. For an update, bump `version` in both
`wxt.config.ts` and `package.json`.

## Publishing

Everything for the listings is in [`store/`](store/README.md): French and
English descriptions, permission justifications, privacy answers,
screenshots and promo tile, the checks to run on each built `manifest.json`,
and the steps for the Chrome Web Store and for addons.mozilla.org.

## Anki (optional)

Anki is the alternative destination, chosen in the settings. Cards go through
the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on and
wait in a queue until **Tout envoyer** (or immediately, if you turn that on).

1. In desktop Anki, install AnkiConnect (code `2055492159`) and restart.
2. The extension's settings page shows its origin (`chrome-extension://…` on
   Chrome, `moz-extension://…` on Firefox). Add it to `webCorsOriginList` in
   AnkiConnect's config:
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
| Permissions | `activeTab`, `scripting`, `storage`, `offscreen`, `contextMenus`; hosts: the site, Naver dictionary audio, Google TTS, AnkiConnect on localhost; content scripts: the site's connect page, `https://www.netflix.com/*`, `https://www.youtube.com/*`, `https://www.viki.com/*`, `https://www.disneyplus.com/*`, `https://www.primevideo.com/*`, `https://www.amazon.fr/gp/video/*` and `https://www.amazon.com/gp/video/*` |

The Clova Voice (Naver Cloud) code path is still in the source, but its
settings are hidden (`SHOW_NAVER_CLOUD = false` in
`entrypoints/options/App.tsx`) and the manifest no longer requests its host,
so released builds never use it.
