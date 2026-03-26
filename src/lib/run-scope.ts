import {
  AdditionalFeature,
  MIGRATION_ADDITIONAL_FEATURES,
} from './wizard-session';

export enum RunWorkArea {
  ProductAnalytics = 'product_analytics',
  ErrorTracking = 'error_tracking',
  FeatureFlags = 'feature_flags',
  LlmAnalytics = 'llm_analytics',
}

export interface WizardRunScope {
  workAreas: RunWorkArea[];
  selectedFeatures: AdditionalFeature[];
}

export const RUN_WORK_AREA_LABELS: Record<RunWorkArea, string> = {
  [RunWorkArea.ProductAnalytics]: 'Product analytics',
  [RunWorkArea.ErrorTracking]: 'Error tracking',
  [RunWorkArea.FeatureFlags]: 'Feature flags',
  [RunWorkArea.LlmAnalytics]: 'LLM analytics',
};

const FEATURE_ORDER: readonly AdditionalFeature[] = [
  AdditionalFeature.LLM,
  AdditionalFeature.AmplitudeMigration,
  AdditionalFeature.SentryMigration,
  AdditionalFeature.LaunchDarklyMigration,
  AdditionalFeature.BraintrustMigration,
];

const WORK_AREA_ORDER: readonly RunWorkArea[] = [
  RunWorkArea.ProductAnalytics,
  RunWorkArea.ErrorTracking,
  RunWorkArea.FeatureFlags,
  RunWorkArea.LlmAnalytics,
];

const FEATURE_WORK_AREAS: Record<AdditionalFeature, readonly RunWorkArea[]> = {
  [AdditionalFeature.LLM]: [RunWorkArea.LlmAnalytics],
  [AdditionalFeature.AmplitudeMigration]: [RunWorkArea.ProductAnalytics],
  [AdditionalFeature.SentryMigration]: [RunWorkArea.ErrorTracking],
  [AdditionalFeature.LaunchDarklyMigration]: [RunWorkArea.FeatureFlags],
  [AdditionalFeature.BraintrustMigration]: [RunWorkArea.LlmAnalytics],
};

export function buildRunScope(
  selectedFeatures: readonly AdditionalFeature[],
): WizardRunScope {
  const selectedFeatureSet = new Set(selectedFeatures);
  const canonicalFeatures = FEATURE_ORDER.filter((feature) =>
    selectedFeatureSet.has(feature),
  );
  const workAreaSet = new Set<RunWorkArea>();

  for (const feature of canonicalFeatures) {
    for (const workArea of FEATURE_WORK_AREAS[feature]) {
      workAreaSet.add(workArea);
    }
  }

  if (workAreaSet.size === 0) {
    workAreaSet.add(RunWorkArea.ProductAnalytics);
  }

  return {
    workAreas: WORK_AREA_ORDER.filter((workArea) => workAreaSet.has(workArea)),
    selectedFeatures: canonicalFeatures,
  };
}

/**
 * Split a run scope into the base setup scope (framework integration only)
 * and the migration features that will run as separate parallel agents.
 */
export function splitRunScope(scope: WizardRunScope): {
  baseScope: WizardRunScope;
  migrationFeatures: AdditionalFeature[];
} {
  const migrationSet = new Set<AdditionalFeature>(
    MIGRATION_ADDITIONAL_FEATURES,
  );
  const migrationFeatures = scope.selectedFeatures.filter((f) =>
    migrationSet.has(f),
  );
  const baseFeatures = scope.selectedFeatures.filter(
    (f) => !migrationSet.has(f),
  );

  return {
    baseScope: buildRunScope(baseFeatures),
    migrationFeatures,
  };
}

export function getRunScopeKey(scope: WizardRunScope): string {
  return JSON.stringify({
    workAreas: scope.workAreas,
    selectedFeatures: scope.selectedFeatures,
  });
}
