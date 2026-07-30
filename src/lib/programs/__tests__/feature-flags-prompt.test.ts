import { featureFlagsConfig } from '@lib/programs/feature-flags';

function getRun() {
  const run = featureFlagsConfig.run;
  expect(run).toBeDefined();
  expect(typeof run).not.toBe('function');

  if (!run || typeof run === 'function') {
    throw new Error('Expected a static feature flags run configuration');
  }

  return run;
}

describe('feature flags program', () => {
  it('installs the skill before planning, then gates writes on confirmation', () => {
    const prompt = getRun().customPrompt?.({} as never) ?? '';

    const installSkill = prompt.indexOf('Call `install_skill`');
    const createTasks = prompt.indexOf('`TaskCreate` calls');
    const confirmProposal = prompt.indexOf(
      'The proposal is an interactive decision gate',
    );

    expect(installSkill).toBeGreaterThan(-1);
    expect(createTasks).toBeGreaterThan(installSkill);
    expect(confirmProposal).toBeGreaterThan(createTasks);
    expect(prompt).toContain('category: "feature-flags"');
    expect(prompt).toContain('one call per workflow stage');
    expect(prompt).toMatch(
      /Do not call `TaskUpdate`, run\s+another tool, or start workflow work until every initial task exists/,
    );
    expect(prompt).toMatch(
      /Before any PostHog write or\s+application source edit, call `wizard_ask`/,
    );
    expect(prompt).toContain(
      '[ABORT] Feature flag proposal confirmation is required.',
    );
    expect(prompt).toContain(
      '[ABORT] A matching PostHog feature flag skill could not be installed.',
    );
  });

  it('keeps SDK and environment inspection inside the installed workflow', () => {
    const prompt = getRun().customPrompt?.({} as never) ?? '';

    expect(prompt).toContain(
      'do not install, reinstall, or upgrade a PostHog SDK package',
    );
    expect(prompt).toMatch(
      /Never\s+open, read, or search value-bearing `\.env\*` files/,
    );
    expect(prompt).toContain('use `check_env_keys`');
    expect(prompt).toContain(
      'The installed skill owns the feature-flag workflow',
    );
  });

  it('ends with a project-specific flag verification handoff', () => {
    const outro = getRun().buildOutroData?.(
      {} as never,
      {
        projectId: 532532,
        host: { appHost: 'https://us.posthog.com/' },
      } as never,
    );

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

  it('maps every Wizard and Context Mill abort contract', () => {
    const abortCases = getRun().abortCases ?? [];
    const emittedSignals = [
      'A working PostHog SDK integration is required.',
      'A matching PostHog feature flag skill could not be installed.',
      'Feature flag proposal confirmation is required.',
      'PostHog feature flag access is required.',
      'The selected feature flag skill does not match this application.',
    ];

    for (const signal of emittedSignals) {
      expect(
        abortCases.some((abortCase) => abortCase.match.test(signal)),
        `Missing abort case for: ${signal}`,
      ).toBe(true);
    }
  });
});
