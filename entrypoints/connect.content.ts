import type { ExtensionMessage } from '../src/types';
import { connectToken, type ConnectReply, type PresentNotice } from '../src/connect';
import { SITE_URL } from '../src/config';
import { deviceName, getInstallId } from '../src/device';

// Runs only on the site's /connect-extension page. That origin is already a
// host permission (the API lives there), so this adds no install warning. The
// page hands over a freshly minted token with window.postMessage; the
// background verifies and stores it. Contract: docs/connect-extension.md.
export default defineContentScript({
  matches: [`${__DOKHAE_SITE_ORIGIN__}/connect-extension*`],
  runAt: 'document_end',
  async main() {
    const origin = new URL(SITE_URL).origin;
    // Belt and braces: the match pattern already pins the page.
    if (location.origin !== origin) return;

    const post = (message: PresentNotice | ConnectReply) => window.postMessage(message, origin);

    post({
      source: 'dokhae-extension',
      type: 'DOKHAE_PRESENT',
      version: browser.runtime.getManifest().version,
      installId: await getInstallId(),
      deviceName: deviceName(),
      rotates: true,
    });

    window.addEventListener('message', async (event: MessageEvent) => {
      // Only the page itself, never a frame or another window.
      if (event.source !== window || event.origin !== origin) return;
      const token = connectToken(event.data);
      if (!token) return;

      let reply: ConnectReply = {
        source: 'dokhae-extension', type: 'DOKHAE_CONNECTED', ok: false, error: 'internal',
      };
      try {
        const resp = (await browser.runtime.sendMessage({
          type: 'CONNECT_TOKEN',
          token,
        } satisfies ExtensionMessage)) as ExtensionMessage | undefined;
        if (resp?.type === 'CONNECT_DONE') {
          reply = {
            source: 'dokhae-extension',
            type: 'DOKHAE_CONNECTED',
            ok: resp.ok,
            ...(resp.email ? { email: resp.email } : {}),
            ...(resp.subscribed !== undefined ? { subscribed: resp.subscribed } : {}),
            ...(resp.error ? { error: resp.error } : {}),
          };
        }
      } catch {
        /* extension reloaded under the page: answer 'internal' */
      }
      post(reply);
    });
  },
});
