// This install's identity for the site's device list: a random id kept for
// the life of the install (so reconnecting takes the same place back), and a
// readable name like "Chrome · Windows".

const INSTALL_KEY = 'installId';

export async function getInstallId(): Promise<string> {
  const stored = await chrome.storage.local.get(INSTALL_KEY);
  const existing = stored[INSTALL_KEY];
  if (typeof existing === 'string' && existing) return existing;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_KEY]: id });
  return id;
}

interface UAData {
  brands?: { brand: string }[];
  platform?: string;
}

export function deviceName(nav: Pick<Navigator, 'userAgent'> & { userAgentData?: UAData } = navigator): string {
  const ua = nav.userAgent ?? '';
  const brands = (nav.userAgentData?.brands ?? []).map((b) => b.brand);
  const browser =
    /Firefox\//.test(ua) ? 'Firefox'
    : brands.includes('Microsoft Edge') || /Edg\//.test(ua) ? 'Edge'
    : brands.includes('Opera') || /OPR\//.test(ua) ? 'Opera'
    : brands.includes('Brave') ? 'Brave'
    : 'Chrome';
  const platform = nav.userAgentData?.platform || ua;
  const os =
    /Windows/i.test(platform) ? 'Windows'
    : /mac/i.test(platform) ? 'Mac'
    : /CrOS|Chrome OS/i.test(platform) ? 'ChromeOS'
    : /Android/i.test(platform) ? 'Android'
    : /Linux/i.test(platform) ? 'Linux'
    : '';
  return os ? `${browser} · ${os}` : browser;
}
