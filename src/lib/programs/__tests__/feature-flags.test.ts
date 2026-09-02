import {
  FEATURE_FLAGS_ABORT_CASES,
  featureFlagsConfig,
} from '@lib/programs/feature-flags/index';

describe('FEATURE_FLAGS_ABORT_CASES', () => {
  // Exact `[ABORT] <reason>` strings the feature-flags-setup skill emits
  // (context-mill `context/skills/feature-flags-setup/description.md`), with
  // the `[ABORT] ` prefix already stripped — matching what the runner passes
  // to `AbortCase.match`.
  const reasons = [
    'unsupported stack for feature flags',
    'posthog not initialized',
    'no posthog project credentials',
    'could not create the feature flag',
  ];

  it.each(reasons)('matches the "%s" abort reason exactly once', (reason) => {
    const matched = FEATURE_FLAGS_ABORT_CASES.filter((c) =>
      c.match.test(reason),
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].message).toBeTruthy();
    expect(matched[0].body).toBeTruthy();
  });

  it('does not abort when no UI surface is available to gate', () => {
    const matched = FEATURE_FLAGS_ABORT_CASES.filter((c) =>
      c.match.test('could not locate a UI surface to gate'),
    );
    expect(matched).toHaveLength(0);
  });
});

describe('featureFlagsConfig', () => {
  it('wires a flat command to the feature-flags-setup skill', () => {
    expect(featureFlagsConfig.command).toBe('feature-flags');
    expect(featureFlagsConfig.id).toBe('feature-flags');
    expect(featureFlagsConfig.skillId).toBe('feature-flags-setup');
    const run = featureFlagsConfig.run;
    if (!run || typeof run === 'function') {
      throw new Error('expected a static run object');
    }
    expect(run.abortCases).toBe(FEATURE_FLAGS_ABORT_CASES);
  });

  it('requires the default integration — this skill extends it, it does not reinstall it', () => {
    expect(featureFlagsConfig.requires).toEqual(['posthog-integration']);
  });
});
