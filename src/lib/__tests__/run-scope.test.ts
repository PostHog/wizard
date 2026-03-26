import { AdditionalFeature } from '../wizard-session';
import {
  buildRunScope,
  getRunScopeKey,
  splitRunScope,
  RunWorkArea,
} from '../run-scope';

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

  describe('splitRunScope', () => {
    it('separates migrations from non-migration features', () => {
      const scope = buildRunScope([
        AdditionalFeature.LLM,
        AdditionalFeature.AmplitudeMigration,
        AdditionalFeature.SentryMigration,
      ]);
      const { baseScope, migrationFeatures } = splitRunScope(scope);

      expect(baseScope.selectedFeatures).toEqual([AdditionalFeature.LLM]);
      expect(baseScope.workAreas).toEqual([RunWorkArea.LlmAnalytics]);
      expect(migrationFeatures).toEqual([
        AdditionalFeature.AmplitudeMigration,
        AdditionalFeature.SentryMigration,
      ]);
    });

    it('returns empty migrations when no migrations selected', () => {
      const scope = buildRunScope([AdditionalFeature.LLM]);
      const { baseScope, migrationFeatures } = splitRunScope(scope);

      expect(baseScope.selectedFeatures).toEqual([AdditionalFeature.LLM]);
      expect(migrationFeatures).toEqual([]);
    });

    it('defaults base scope to product analytics when only migrations selected', () => {
      const scope = buildRunScope([AdditionalFeature.SentryMigration]);
      const { baseScope, migrationFeatures } = splitRunScope(scope);

      expect(baseScope.workAreas).toEqual([RunWorkArea.ProductAnalytics]);
      expect(baseScope.selectedFeatures).toEqual([]);
      expect(migrationFeatures).toEqual([AdditionalFeature.SentryMigration]);
    });

    it('handles empty scope', () => {
      const scope = buildRunScope([]);
      const { baseScope, migrationFeatures } = splitRunScope(scope);

      expect(baseScope.workAreas).toEqual([RunWorkArea.ProductAnalytics]);
      expect(migrationFeatures).toEqual([]);
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
