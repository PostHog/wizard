import { fetchSkillMenu, type SkillMenu } from '@shared/skill-menu';
import { analytics } from '@utils/analytics';

vi.mock('@utils/analytics', () => ({ analytics: { setTag: vi.fn() } }));

describe('fetchSkillMenu', () => {
  const noSleep = () => Promise.resolve();
  const menu: SkillMenu = { categories: { integration: [] } };
  const respond = (body: unknown) => () =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(body),
    });

  it('retries a flaky menu fetch before succeeding', async () => {
    let attempts = 0;

    const result = await fetchSkillMenu('http://localhost:8765', {
      fetchImpl: (() => {
        attempts += 1;
        if (attempts < 3) return Promise.reject(new Error('reset'));
        return respond(menu)();
      }) as any,
      sleepImpl: noSleep,
    });

    expect(attempts).toBe(3);
    expect(result).toEqual(menu);
  });

  it('returns null after exhausting retries', async () => {
    let attempts = 0;

    const result = await fetchSkillMenu('http://localhost:8765', {
      fetchImpl: (() => {
        attempts += 1;
        return Promise.reject(new Error('network down'));
      }) as any,
      sleepImpl: noSleep,
      maxAttempts: 3,
    });

    expect(attempts).toBe(3);
    expect(result).toBeNull();
  });

  it('expands a bundle entry into one entry per variant, each with the family of its category', async () => {
    const bundled: SkillMenu = {
      categories: {
        'flow/capture': [
          {
            id: 'capture',
            name: 'Capture',
            bundle: true,
            downloadUrl: 'http://localhost:8765/capture.json',
            variants: [
              { id: 'capture-rails', tags: ['framework:rails', 'default'] },
              { id: 'capture-react', tags: ['framework:react'] },
            ],
          },
        ],
      },
    };

    const result = await fetchSkillMenu('http://localhost:8765', {
      fetchImpl: respond(bundled) as any,
      sleepImpl: noSleep,
    });

    expect(result?.categories['flow/capture']).toEqual([
      {
        id: 'capture-rails',
        tags: ['framework:rails', 'default'],
        name: 'Capture',
        family: 'flow-capture',
        bundle: true,
        downloadUrl: 'http://localhost:8765/capture.json',
      },
      {
        id: 'capture-react',
        tags: ['framework:react'],
        name: 'Capture',
        family: 'flow-capture',
        bundle: true,
        downloadUrl: 'http://localhost:8765/capture.json',
      },
    ]);
  });

  it("gives each bundle variant the bundle's title and description, keeping its own tags", async () => {
    const bundled: SkillMenu = {
      categories: {
        integration: [
          {
            id: 'capture',
            name: 'Capture',
            bundle: true,
            title: 'Capture step',
            description: 'Instrument the planned events',
            downloadUrl: 'http://localhost:8765/capture.json',
            variants: [
              {
                id: 'capture-rails',
                tags: ['framework:rails', 'capture'],
              },
              { id: 'capture-react', title: 'React' },
            ],
          },
        ],
      },
    };

    const result = await fetchSkillMenu('http://localhost:8765', {
      fetchImpl: respond(bundled) as any,
      sleepImpl: noSleep,
    });

    const [rails, react] = result?.categories.integration ?? [];
    expect(rails).toMatchObject({
      title: 'Capture step',
      description: 'Instrument the planned events',
      tags: ['framework:rails', 'capture'],
    });
    expect(react.title).toBe('React');
  });

  it('tags later events with the context-mill release that built the menu', async () => {
    await fetchSkillMenu('http://localhost:8765', {
      fetchImpl: respond({ ...menu, buildVersion: '1.60.0' }) as any,
      sleepImpl: noSleep,
    });
    expect(analytics.setTag).toHaveBeenCalledWith(
      'context_mill_version',
      '1.60.0',
    );
  });
});
