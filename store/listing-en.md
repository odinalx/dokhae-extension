# Chrome Web Store listing · English (secondary language)

The extension UI is French only, so say so in the listing: English readers
should know before installing.

## Name

Dokhae

## Short description (132 characters max)

Read Korean webtoons: frame a speech bubble, understand every word, save it to your Dokhae deck. Interface in French.

## Full description

Dokhae (독해, "reading") helps you read Korean webtoons right on the page.

How it works:
1. Click the Dokhae icon, then "Scanner une bulle" (scan a bubble).
2. Draw a box around a speech bubble: Dokhae reads the Korean text in that area.
3. The sentence appears word by word, each word underlined by part of speech (noun, verb, particle…).
4. Click a word: translation, dictionary form, speech level, example sentence and pronunciation.
5. "Ajouter au deck": the word joins your spaced-repetition reviews on dokhae.fr.

You can also select Korean text on any page, then right-click and choose "Analyser avec Dokhae", or click "Analyser la sélection" in the extension's window.

Every word you add keeps a link to the page you found it on: from your reviews, one click takes you back to the chapter.

What matters:
• Text recognition runs on your computer. Only the recognised text is sent to Dokhae for analysis.
• Dokhae only reads the tab you call it on, when you call it. Nothing runs in the background on the sites you visit.
• No ads, no data sales.
• Words can go to Anki instead (AnkiConnect add-on), if you prefer.

Subscription required: the extension works with a subscribed Dokhae account. Plans on https://dokhae.fr/pricing

The interface, translations and grammar notes are in French.

## Category

Education

## Single purpose

Help people read Korean in webtoons and on the web: the extension reads the Korean text in an area or selection the user picks, explains it word by word, and saves the words they choose to their Dokhae review deck.

## Permission justifications

| Permission | Why |
|---|---|
| `activeTab` | When the user clicks "Scanner une bulle" or the context menu entry, the extension gets the active tab, and only that tab, to show the selection overlay and capture the visible area they frame. |
| `scripting` | Inject the Dokhae panel into the active tab on demand (under `activeTab`), instead of declaring a content script on every site. |
| `storage` | Keep settings (Dokhae access token, a random id for this install, chosen deck, Anki option), the cached subscription state, and words waiting to be sent. |
| `offscreen` | Run text recognition (Tesseract, WebAssembly) in a Web Worker and play pronunciation audio; a service worker can do neither. |
| `contextMenus` | The "Analyser avec Dokhae" right-click entry on selected text. |
| `https://dokhae.fr/*` | The Dokhae API: account check, analysis of the recognised text, saving words to the deck. The one-click connect script runs only on `https://dokhae.fr/connect-extension`. |
| `https://translate.google.com/*` | Fallback pronunciation voice (Google text to speech) when the dictionary has no recording. |
| `https://ko.dict.naver.com/*` | Look up a word's audio recording in Naver's Korean dictionary. |
| `https://dict-dn.pstatic.net/*` | Download that audio file (Naver dictionary's file server). |
| `http://127.0.0.1:8765/*`, `http://localhost:8765/*` | AnkiConnect on the user's own computer, used only if they pick Anki as the destination for their cards. |

Remote code: **no**. All code ships in the package, the Korean recognition model included.

## Privacy practices tab

Data collected:
- **Personally identifiable information**: yes, the Dokhae account email, received from the site to show which account is connected.
- **Authentication information**: yes, the Dokhae access token (`sori_…`), stored locally and only ever sent to dokhae.fr.
- **Website content**: yes, the Korean text recognised in the framed area (or the selected text) is sent to dokhae.fr for analysis. Words the user listens to are sent to the Naver dictionary or Google for pronunciation.
- **Web history**: yes, to be safe: when the user adds a word to their deck, the address of the page it came from is saved with the card, so they can go back to it. Nothing is sent until they add a word.
- Health, financial, personal communications, location, user activity: **no**.

Notes for the free-text fields:
- The capture of the framed area is processed locally (on-device text recognition); the image never leaves the device.
- Words added to the deck (word, translation, example sentence, address of the source page) are stored in the user's Dokhae account, where the user can edit or clear that address.
- No data is sold, used for advertising, or used to determine creditworthiness.

Certifications to tick:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Links

- Privacy policy: https://dokhae.fr/privacy
- Website: https://dokhae.fr
- Support: contact@dokhae.fr

## Assets

Same files as the French listing (store/assets/). The screenshots show the
French interface, which is what English users will get.
