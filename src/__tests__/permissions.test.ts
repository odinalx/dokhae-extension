import { describe, expect, it } from 'vitest';
import { contentScriptOrigins } from '../permissions';

describe('contentScriptOrigins', () => {
  it('lists the hosts only a content script asks for', () => {
    expect(
      contentScriptOrigins({
        host_permissions: ['https://dokhae.fr/*', 'https://translate.google.com/*'],
        content_scripts: [
          { matches: ['https://dokhae.fr/connect-extension*'] },
          { matches: ['https://www.netflix.com/*'] },
          { matches: ['https://www.netflix.com/*'] },
        ],
      }),
    ).toEqual(['https://www.netflix.com/*']);
  });

  it('is empty without content scripts', () => {
    expect(contentScriptOrigins({ host_permissions: ['https://dokhae.fr/*'] })).toEqual([]);
  });
});
