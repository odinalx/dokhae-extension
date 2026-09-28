/*
 * Site access. Chrome grants the manifest's host permissions at install;
 * Firefox (MV3) treats them as optional and lets the reader refuse or revoke
 * them. Without them nothing works there: the account check, the analysis,
 * the audio, even the connect script on dokhae.fr. So Firefox asks, from a
 * click (the only moment a permission prompt may open).
 */

/** Every origin the extension needs, read from the manifest so the list lives in one place. */
export function neededOrigins(): string[] {
  return chrome.runtime.getManifest().host_permissions ?? [];
}

export async function hasSiteAccess(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: neededOrigins() });
  } catch {
    // A browser without the API grants at install, like Chrome.
    return true;
  }
}

/** Opens the browser's prompt; call it straight from a click handler. */
export function requestSiteAccess(): Promise<boolean> {
  return browser.permissions.request({ origins: neededOrigins() });
}
