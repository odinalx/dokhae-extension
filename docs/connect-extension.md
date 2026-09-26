# One-click connect: the `/connect-extension` contract

The extension no longer asks people to copy an API token by hand. Its
"Connecter mon compte" button opens `${SITE_URL}/connect-extension` on the
site. That page mints a token for the signed-in account and hands it to the
extension with `window.postMessage`. This file is the whole contract, so the
page can be built without reading the extension's code.

## Where it runs

The extension declares a content script (`entrypoints/connect.content.ts`)
matching only `${SITE_URL}/connect-extension*`, where `SITE_URL` is the
origin baked in at build time from `WXT_SITE_URL` (`https://dokhae.fr` in
production, `http://localhost:3000` for a local build). It runs at
`document_end`. Nothing of the extension runs on any other page of the site.

## Messages

All messages go through `window.postMessage` on the page's own window, with
the site origin as `targetOrigin`. Both sides ignore anything that does not
match exactly.

### 1. Extension to page, on load: `DOKHAE_PRESENT`

```js
{
  source: "dokhae-extension",
  type: "DOKHAE_PRESENT",
  version: "1.3.0",
  installId: "3f2c9a8e-…",       // random, kept for the life of the install
  deviceName: "Chrome · Windows", // shown in the account's device list
  rotates: true,                  // stores the token /api/me rotates
}
```

`installId`, `deviceName` and `rotates` exist since 1.3. The page passes them
to the site when it connects the device: the same `installId` takes its own
place back instead of a new one, and only a client that says `rotates` gets
its token rotated. A 1.2 extension sends none of them; the page then keeps an
id of its own in `localStorage` for that browser.

Posted once, as soon as the content script runs. If the page has not seen it
(say 1.5 s after load), assume the extension is not installed (or is an old
version) and show a link to the Chrome Web Store instead of the button. Since
the content script runs at `document_end`, register the listener in a script
that runs before that (inline in the HTML, or early in the bundle), or the
notice can be missed. The page can also just send `DOKHAE_CONNECT` and treat
the absence of a reply as "not installed".

### 2. Page to extension: `DOKHAE_CONNECT`

```js
window.postMessage(
  { source: "dokhae-site", type: "DOKHAE_CONNECT", token: "sori_…" },
  location.origin,
)
```

- `token` must match `/^sori_[A-Za-z0-9_-]{20,}$/`, otherwise the message is
  ignored (no reply).
- The extension only accepts it when `event.source === window` and
  `event.origin` is the site origin, so posting from an iframe does not work.
- Send it after a user action (a "Connecter" button click), and only for a
  signed-in, subscribed account. The site connects the device first (two
  browsers per account; when both places are taken the page offers to
  replace one) and only then posts the token.

### 3. Extension to page: `DOKHAE_CONNECTED`

```js
{
  source: "dokhae-extension",
  type: "DOKHAE_CONNECTED",
  ok: true | false,
  email?: "someone@example.com",  // when ok
  subscribed?: true | false,       // when ok: false means show pricing
  error?: "invalid_token" | "network" | "internal"  // when not ok
}
```

Before replying, the extension calls `GET /api/me` with the token. Only a
token the API accepts replaces the stored one, so a failed connect never
signs a working install out.

| `error` | Meaning | Suggested copy |
|---|---|---|
| `invalid_token` | `/api/me` answered 401 | "Ce jeton a été refusé. Réessaie." |
| `network` | the extension could not reach the API | "Impossible de joindre Dokhae. Vérifie ta connexion." |
| `internal` | anything else (extension updated under the page, …) | "Recharge la page et réessaie." |

On `ok: true`, the page can say "Extension connectée à {email}" and, when
`subscribed` is false, point to `/pricing` (scanning needs a plan). The
popup and the options page pick the new token up on their own.

## Minimal page script

```js
const ORIGIN = location.origin
let present = false
addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== ORIGIN) return
  const d = e.data
  if (d?.source !== "dokhae-extension") return
  if (d.type === "DOKHAE_PRESENT") present = true
  if (d.type === "DOKHAE_CONNECTED") render(d)
})

async function connect() {
  // registerExtensionFn on the site: connects the device, returns its token
  const { token } = await registerDevice({ installId, name: deviceName, rotates })
  postMessage({ source: "dokhae-site", type: "DOKHAE_CONNECT", token }, ORIGIN)
}
```

## After connecting: rotation and revocation

- `GET /api/me` may answer with a `token` field: the device's new token. The
  extension stores it at once (`rotateSiteToken`). The old one keeps working
  ten minutes for requests already in flight.
- Using the old token after that, while the new one is in use, is what a
  copied token looks like: the site disconnects the device and answers
  `401 { error: "device_revoked", reason: "reuse" }`. Other reasons are
  `replaced`, `user`, `all`, `inactive`, `password`, `signout`; the popup and
  settings word each one.
- **Déconnecter** in the settings calls `POST /api/device/logout` before
  forgetting the token.

## Security notes

- The token only travels inside the page's own window, and the page is on the
  site origin, which already holds the account session.
- The background re-checks that the message came from the connect content
  script on the connect page (`sender.url`) before storing anything.
- The match pattern is on the site origin, which is already a host permission
  of the extension, so this feature adds no permission warning at install.
