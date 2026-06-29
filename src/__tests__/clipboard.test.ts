import { browserOpenCommands } from '@utils/clipboard';

const URL =
  'https://us.posthog.com/api/environments/227926/integrations/authorize?kind=github';

describe('browserOpenCommands', () => {
  it('uses `open` on macOS, URL as a single argv', () => {
    expect(browserOpenCommands(URL, 'darwin')).toEqual([
      { cmd: 'open', args: [URL] },
    ]);
  });

  it('uses `cmd /c start "" <url>` on Windows, URL as a single argv', () => {
    expect(browserOpenCommands(URL, 'win32')).toEqual([
      { cmd: 'cmd', args: ['/c', 'start', '', URL] },
    ]);
  });

  it('falls back from xdg-open to x-www-browser on Linux', () => {
    expect(browserOpenCommands(URL, 'linux')).toEqual([
      { cmd: 'xdg-open', args: [URL] },
      { cmd: 'x-www-browser', args: [URL] },
    ]);
  });

  it('never splits the URL across argv elements (no shell parsing surface)', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      for (const { args } of browserOpenCommands(URL, platform)) {
        // The full URL — query string and all — must survive as one argv entry.
        expect(args).toContain(URL);
      }
    }
  });
});
