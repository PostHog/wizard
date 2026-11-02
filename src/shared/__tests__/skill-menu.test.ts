import {
  expandBundleEntry,
  fetchSkillMenu,
  filterSkillEntriesByCaptureMode,
  skillEntryMatchesCaptureMode,
  type SkillEntry,
  type SkillMenu,
} from '@shared/skill-menu';

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

  it('expands a bundle entry into one entry per variant', async () => {
    const bundled: SkillMenu = {
      categories: {
        integration: [
          {
            id: 'capture',
            name: 'Capture',
            group: 'capture',
            bundle: true,
            downloadUrl: 'http://localhost:8765/capture.json',
            variants: [
              { id: 'capture-rails', framework: 'rails', default: true },
              { id: 'capture-react', framework: 'react' },
            ],
          },
        ],
      },
    };

    const result = await fetchSkillMenu('http://localhost:8765', {
      fetchImpl: respond(bundled) as any,
      sleepImpl: noSleep,
    });

    expect(result?.categories.integration).toEqual([
      {
        id: 'capture-rails',
        framework: 'rails',
        default: true,
        name: 'Capture',
        group: 'capture',
        bundle: true,
        downloadUrl: 'http://localhost:8765/capture.json',
      },
      {
        id: 'capture-react',
        framework: 'react',
        name: 'Capture',
        group: 'capture',
        bundle: true,
        downloadUrl: 'http://localhost:8765/capture.json',
      },
    ]);
  });
});

describe('capture-mode filtering', () => {
  const neutral: Pick<SkillEntry, 'id' | 'framework' | 'captureMode'> = {
    id: 'integration-django',
    framework: 'django',
  };
  const legacy = {
    id: 'integration-django-legacy',
    framework: 'django',
    captureMode: 'legacy' as const,
  };
  const v1 = {
    id: 'integration-django-v1',
    framework: 'django',
    captureMode: 'v1' as const,
  };

  it('keeps untagged entries for every mode and tagged entries for their own', () => {
    expect(
      filterSkillEntriesByCaptureMode([neutral, legacy, v1], 'v1').map(
        (e) => e.id,
      ),
    ).toEqual(['integration-django', 'integration-django-v1']);
    expect(
      filterSkillEntriesByCaptureMode([neutral, legacy, v1], 'legacy').map(
        (e) => e.id,
      ),
    ).toEqual(['integration-django', 'integration-django-legacy']);
  });

  it('reads a run without a resolved mode as legacy', () => {
    expect(
      filterSkillEntriesByCaptureMode([neutral, legacy, v1], undefined).map(
        (e) => e.id,
      ),
    ).toEqual(['integration-django', 'integration-django-legacy']);
    expect(skillEntryMatchesCaptureMode(v1, undefined)).toBe(false);
  });

  it("expands a bundle keeping each variant's capture mode", () => {
    const expanded = expandBundleEntry({
      id: 'integration-v2-install',
      name: 'Install',
      group: 'integration-v2-install',
      downloadUrl: 'https://example.com/bundle.json',
      bundle: true,
      variants: [
        { id: 'integration-v2-install-python', framework: 'python' },
        {
          id: 'integration-v2-install-python-v1',
          framework: 'python',
          captureMode: 'v1',
        },
      ],
    });
    expect(expanded.map((e) => e.captureMode)).toEqual([undefined, 'v1']);
    expect(expanded.every((e) => e.bundle && e.group)).toBe(true);
  });
});
