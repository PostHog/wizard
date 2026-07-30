import { featureFlagsConfig } from '@lib/programs/feature-flags';

describe('feature flags program', () => {
  it('discovers and installs the framework-specific feature flag skill', () => {
    const run = featureFlagsConfig.run;
    expect(run).toBeDefined();
    expect(typeof run).not.toBe('function');

    const prompt =
      run && typeof run !== 'function' ? run.customPrompt?.({} as never) : '';

    expect(prompt).toContain('category: "feature-flags"');
    expect(prompt).toContain('feature-flags-nextjs');
    expect(prompt).toContain('install_skill');
    expect(prompt).toContain(
      '[ABORT] A matching PostHog feature flag skill could not be installed.',
    );
  });

  it('declares the PostHog integration prerequisite', () => {
    expect(featureFlagsConfig.requires).toEqual(['posthog-integration']);
  });

  it('uses the existing SDK instead of installing or upgrading it', () => {
    const run = featureFlagsConfig.run;
    expect(run).toBeDefined();
    expect(typeof run).not.toBe('function');

    const prompt =
      run && typeof run !== 'function' ? run.customPrompt?.({} as never) : '';

    expect(prompt).toMatch(/Verify existing\s+PostHog SDK integration/);
    expect(prompt).toContain(
      'do not install, reinstall, or upgrade a PostHog SDK package',
    );
    expect(prompt).toContain(
      '[ABORT] A working PostHog SDK integration is required.',
    );
  });

  it('leaves the feature flag workflow in the installed skill', () => {
    const run = featureFlagsConfig.run;
    expect(run).toBeDefined();
    expect(typeof run).not.toBe('function');

    const prompt =
      run && typeof run !== 'function' ? run.customPrompt?.({} as never) : '';

    expect(prompt).toContain(
      'The installed skill owns the feature-flag workflow',
    );
    expect(prompt).toContain('posthog-feature-flags-report.md');
    expect(prompt).toContain('"Try your flag"');
    expect(prompt).toContain('the control');
    expect(prompt).toContain('the flagged behavior');
    expect(prompt).not.toContain('Do not capture user-entered text');
    expect(prompt).not.toContain('follow-up read confirms it');
  });

  it('ends with a project-specific flag verification handoff', () => {
    const run = featureFlagsConfig.run;
    expect(run).toBeDefined();
    expect(typeof run).not.toBe('function');

    const outro =
      run && typeof run !== 'function'
        ? run.buildOutroData?.(
            {} as never,
            {
              projectId: 532532,
              host: { appHost: 'https://us.posthog.com/' },
            } as never,
          )
        : undefined;

    expect(outro).toMatchObject({
      message: 'Your feature flag is ready to test',
      primaryLink: {
        label: 'Open Feature Flags',
        url: 'https://us.posthog.com/project/532532/feature_flags',
      },
      nextSteps: {
        heading: 'Try your flag:',
        items: [
          'Exercise the control experience',
          'Enable the flag for your test person and exercise the flagged experience',
          'Confirm the live evaluation in PostHog, then restore the safe rollout',
        ],
      },
      reportFile: 'posthog-feature-flags-report.md',
      docsUrl: 'https://posthog.com/docs/feature-flags',
    });
    expect(outro?.handoffPrompt).toContain(
      'complete any blocked or not-run checks',
    );
    expect(outro?.handoffPrompt).toContain(
      'get my approval before changing the flag rollout',
    );
  });

  it('maps the skill abort signals to actionable outros', () => {
    const run = featureFlagsConfig.run;
    expect(run).toBeDefined();
    expect(typeof run).not.toBe('function');

    const abortCases =
      run && typeof run !== 'function' ? run.abortCases ?? [] : [];

    expect(abortCases).toHaveLength(4);
    const missingSdk = abortCases.find((abortCase) =>
      abortCase.match.test(
        'A working PostHog SDK integration is required. Run the default PostHog Wizard.',
      ),
    );
    expect(missingSdk).toMatchObject({
      message: 'PostHog SDK setup required',
      body: 'Run the standard PostHog Wizard first, then run `wizard feature-flags` again.',
      docsUrl: 'https://posthog.com/docs/getting-started/install',
    });
    expect(missingSdk?.body).not.toContain('report');
    const missingSkill = abortCases.find((abortCase) =>
      abortCase.match.test(
        'A matching PostHog feature flag skill could not be installed.',
      ),
    );
    expect(missingSkill).toMatchObject({
      message: 'Feature flag skill unavailable',
      body: 'The Wizard could not find or install a feature flag skill that matches this app. Check your connection and try again.',
      docsUrl: 'https://posthog.com/docs/feature-flags',
    });
    expect(
      abortCases.some((abortCase) =>
        abortCase.match.test('PostHog feature flag access is required.'),
      ),
    ).toBe(true);
    expect(
      abortCases.some((abortCase) =>
        abortCase.match.test(
          'The selected feature flag skill does not match this application.',
        ),
      ),
    ).toBe(true);
  });

  it('ships feature flag teaching content instead of the generic skill deck', () => {
    const blocks = featureFlagsConfig.getContentBlocks?.() ?? [];
    const copy = blocks
      .flatMap((block) => {
        if (
          typeof block === 'object' &&
          block !== null &&
          'content' in block &&
          typeof block.content === 'string'
        ) {
          return [block.content];
        }
        return [];
      })
      .join(' ');

    expect(blocks.length).toBeGreaterThan(10);
    expect(copy).toContain('control experience');
    expect(copy).toContain('security boundary');
    expect(copy).toContain('exercising both experiences');
  });
});
