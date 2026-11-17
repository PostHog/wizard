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

  it('gives each entry the family of its category, and leaves out a bundle of variants with any category it empties', async () => {
    const published = {
      categories: {
        'flow/capture': [
          {
            id: 'flow-capture',
            name: 'Capture',
            downloadUrl: 'http://localhost:8765/flow-capture.zip',
          },
          {
            id: 'old-capture',
            name: 'Capture',
            bundle: true,
            downloadUrl: 'http://localhost:8765/old-capture.json',
            variants: [{ id: 'old-capture-rails' }],
          },
        ],
        'old/only': [
          {
            id: 'old-only',
            name: 'Only',
            bundle: true,
            downloadUrl: 'http://localhost:8765/old-only.json',
            variants: [{ id: 'old-only-rails' }],
          },
        ],
      },
    };

    const result = await fetchSkillMenu('http://localhost:8765', {
      fetchImpl: respond(published) as any,
      sleepImpl: noSleep,
    });

    expect(result?.categories['flow/capture']).toEqual([
      {
        id: 'flow-capture',
        name: 'Capture',
        family: 'flow-capture',
        downloadUrl: 'http://localhost:8765/flow-capture.zip',
      },
    ]);
    expect(Object.keys(result?.categories ?? {})).toEqual(['flow/capture']);
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
