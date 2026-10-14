/*
 * Site access. Chrome grants the manifest's host permissions at install;
 * Firefox (MV3) treats them as optional and lets the reader refuse or revoke
 * them. Without them nothing works there: the account check, the analysis,
 * the audio, even the connect script on dokhae.fr. So Firefox asks, from a
 * click (the only moment a permission prompt may open).
 *
 * Content scripts count too: on Firefox the Netflix and YouTube subtitles only
 * run once www.netflix.com and www.youtube.com are allowed. Those are
 * features, not requirements, so they are checked apart and never block the
 * rest of the extension.
 */

type ManifestLike = {
  host_permissions?: string[];
  content_scripts?: { matches?: string[] }[];
};

/** Every origin the extension needs, read from the manifest so the list lives in one place. */
export function neededOrigins(): string[] {
  return chrome.runtime.getManifest().host_permissions ?? [];
}

/**
 * Origins only a content script asks for (Netflix and YouTube), as host patterns
 * ("https://www.netflix.com/*"). Those already covered by a host permission
 * (the connect page on the site) are left out.
 */
export function contentScriptOrigins(manifest: ManifestLike): string[] {
  const hosts = new Set(manifest.host_permissions ?? []);
  const origins = new Set<string>();
  for (const script of manifest.content_scripts ?? []) {
    for (const match of script.matches ?? []) {
      const m = /^(https?|\*):\/\/([^/]+)\//.exec(match);
      if (!m) continue;
      const origin = `${m[1]}://${m[2]}/*`;
      if (!hosts.has(origin)) origins.add(origin);
    }
  }
  return [...origins];
}

function featureOrigins(): string[] {
  return contentScriptOrigins(chrome.runtime.getManifest() as ManifestLike);
}

async function contains(origins: string[]): Promise<boolean> {
  if (!origins.length) return true;
  try {
    return await browser.permissions.contains({ origins });
  } catch {
    // A browser without the API grants at install, like Chrome.
    return true;
  }
}

export function hasSiteAccess(): Promise<boolean> {
  return contains(neededOrigins());
}

/** Whether the video subtitles may run on every video site (always true on Chrome). */
export function hasVideoAccess(): Promise<boolean> {
  return contains(featureOrigins());
}

/**
 * Opens the browser's prompt; call it straight from a click handler. Asks for
 * the video sites in the same prompt, so a new reader answers once.
 */
export function requestSiteAccess(): Promise<boolean> {
  return browser.permissions.request({ origins: [...neededOrigins(), ...featureOrigins()] });
}

/** Opens the browser's prompt for the video sites alone; call it from a click handler. */
export function requestVideoAccess(): Promise<boolean> {
  return browser.permissions.request({ origins: featureOrigins() });
}
