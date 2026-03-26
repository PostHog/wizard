import { AdditionalFeature } from '../wizard-session';
import { buildRunScope, getRunScopeKey, RunWorkArea } from '../run-scope';

describe('run-scope', () => {
  it('defaults to product analytics when no extra features are selected', () => {
    expect(buildRunScope([])).toEqual({
      workAreas: [RunWorkArea.ProductAnalytics],
      selectedFeatures: [],
    });
  });

  it('uses error tracking only for a sentry-only run', () => {
    expect(buildRunScope([AdditionalFeature.SentryMigration])).toEqual({
      workAreas: [RunWorkArea.ErrorTracking],
      selectedFeatures: [AdditionalFeature.SentryMigration],
    });
  });

  it('includes product analytics when amplitude migration is selected', () => {
    expect(buildRunScope([AdditionalFeature.AmplitudeMigration])).toEqual({
      workAreas: [RunWorkArea.ProductAnalytics],
      selectedFeatures: [AdditionalFeature.AmplitudeMigration],
    });
  });

  it('supports multiple requested work areas in canonical order', () => {
    expect(
      buildRunScope([
        AdditionalFeature.SentryMigration,
        AdditionalFeature.AmplitudeMigration,
        AdditionalFeature.LLM,
      ]),
    ).toEqual({
      workAreas: [
        RunWorkArea.ProductAnalytics,
        RunWorkArea.ErrorTracking,
        RunWorkArea.LlmAnalytics,
      ],
      selectedFeatures: [
        AdditionalFeature.LLM,
        AdditionalFeature.AmplitudeMigration,
        AdditionalFeature.SentryMigration,
      ],
    });
  });

  it('builds a stable cache key regardless of selection order', () => {
    const first = getRunScopeKey(
      buildRunScope([
        AdditionalFeature.SentryMigration,
        AdditionalFeature.AmplitudeMigration,
      ]),
    );
    const second = getRunScopeKey(
      buildRunScope([
        AdditionalFeature.AmplitudeMigration,
        AdditionalFeature.SentryMigration,
      ]),
    );

    expect(first).toBe(second);
  });
});
