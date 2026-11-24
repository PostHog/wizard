import { EventEmitter } from 'node:events';
import opn from 'opn';
import { openTrackedLinkOrFail, withUtm } from '../links';

vi.mock(import('@env'), async (importOriginal) => ({
  ...(await importOriginal()),
  NODE_ENV: 'production',
}));
vi.mock('opn', () => ({ default: vi.fn() }));
vi.mock(import('../analytics'), () => ({
  analytics: { wizardCapture: vi.fn() } as never,
}));

describe('withUtm', () => {
  it('tags a URL with the wizard UTM params and no campaign', () => {
    const url = withUtm('https://us.posthog.com/products', 'outro-continue');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('utm_source')).toBe('wizard');
    expect(parsed.searchParams.get('utm_medium')).toBe('cli');
    expect(parsed.searchParams.get('utm_content')).toBe('outro-continue');
    expect(parsed.searchParams.has('utm_campaign')).toBe(false);
  });

  it('preserves existing query params and fragments', () => {
    const url = withUtm(
      'https://app.posthog.com/integrations/slack?a=1#connect',
      'slack-connect-setup',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('a')).toBe('1');
    expect(parsed.searchParams.get('utm_source')).toBe('wizard');
    expect(parsed.hash).toBe('#connect');
  });

  it('does not re-tag a URL that already carries a utm_source', () => {
    const once = withUtm('https://us.posthog.com/x', 'first');
    const twice = withUtm(once, 'second');
    expect(twice).toBe(once);
  });

  it('returns unparseable input untouched', () => {
    expect(withUtm('not a url', 'x')).toBe('not a url');
  });
});

describe('openTrackedLinkOrFail', () => {
  /** An opener process that ends the way `end` says once the link is handed to it. */
  function opener(
    end: (child: EventEmitter) => void,
    exitedWith: number | null = null,
  ) {
    vi.mocked(opn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { exitCode: exitedWith });
      setImmediate(() => end(child));
      return Promise.resolve(child as never);
    });
  }

  it.each([
    {
      exit: 'exits cleanly',
      end: (c: EventEmitter) => c.emit('exit', 0),
      opened: true,
    },
    {
      exit: 'exits with an error',
      end: (c: EventEmitter) => c.emit('exit', 3),
      opened: false,
    },
    {
      exit: 'cannot start',
      end: (c: EventEmitter) => c.emit('error', new Error('ENOENT')),
      opened: false,
    },
    {
      exit: 'already exited with an error',
      end: () => undefined,
      exitedWith: 3,
      opened: false,
    },
  ])(
    'resolves $opened when the opener $exit',
    async ({ end, exitedWith, opened }) => {
      opener(end, exitedWith);
      await expect(
        openTrackedLinkOrFail('http://localhost:8239/authorize', 'oauth'),
      ).resolves.toBe(opened);
    },
  );

  it('resolves false when the opener rejects', async () => {
    vi.mocked(opn).mockRejectedValue(new Error('no opener'));
    await expect(
      openTrackedLinkOrFail('http://localhost:8239/authorize', 'oauth'),
    ).resolves.toBe(false);
  });
});
