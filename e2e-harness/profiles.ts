/**
 * Per-program e2e profiles — the UI choices a headless run makes driving each
 * program's flow.
 *
 * Each program declares its test path as JSON next to it
 * (`src/lib/programs/<program>/test/e2e.json`): a `profile` (the options the run
 * auto-takes) plus a documented `path`. {@link profileFor} loads the `profile`
 * and maps it by program id.
 *
 * {@link resolveE2eProfile} folds the run's env-var inputs into a profile once,
 * so `decideE2eAction` stays a pure function of (state, profile).
 */

import { Program, type ProgramId } from '@lib/programs/program-registry';
import {
  DEFAULT_E2E_PROFILE,
  DEFAULT_E2E_VARIATION,
  type AskAnswerRule,
  type WizardE2eProfile,
  type WizardE2eVariation,
} from './e2e-profile.js';
import posthogIntegrationE2e from '@lib/programs/posthog-integration/test/e2e.json';
import aiObservabilityE2e from '@lib/programs/ai-observability/test/e2e.json';
import metricsE2e from '@lib/programs/metrics/test/e2e.json';
import replayVisionE2e from '@lib/programs/replay-vision/test/e2e.json';
import selfDrivingE2e from '@lib/programs/self-driving/test/e2e.json';
import sourceMapsE2e from '@lib/programs/error-tracking-upload-source-maps/test/e2e.json';
import errorTrackingE2e from '@lib/programs/error-tracking/test/e2e.json';
import warehouseSourceE2e from '@lib/programs/warehouse-source/test/e2e.json';

const PROFILES: Partial<Record<ProgramId, WizardE2eProfile>> = {
  [Program.PostHogIntegration]:
    posthogIntegrationE2e.profile as WizardE2eProfile,
  [Program.AiObservability]: aiObservabilityE2e.profile as WizardE2eProfile,
  [Program.Metrics]: metricsE2e.profile as WizardE2eProfile,
  [Program.ReplayVision]: replayVisionE2e.profile as WizardE2eProfile,
  [Program.SelfDriving]: selfDrivingE2e.profile as WizardE2eProfile,
  [Program.ErrorTrackingUploadSourceMaps]:
    sourceMapsE2e.profile as WizardE2eProfile,
  [Program.ErrorTracking]: errorTrackingE2e.profile as WizardE2eProfile,
  [Program.WarehouseSource]: warehouseSourceE2e.profile as WizardE2eProfile,
};

const VARIATIONS: Partial<Record<ProgramId, WizardE2eVariation[]>> = {
  [Program.PostHogIntegration]:
    posthogIntegrationE2e.variations as WizardE2eVariation[],
  [Program.AiObservability]:
    aiObservabilityE2e.variations as WizardE2eVariation[],
  [Program.Metrics]: metricsE2e.variations as WizardE2eVariation[],
  [Program.ReplayVision]: replayVisionE2e.variations as WizardE2eVariation[],
  [Program.ErrorTracking]: errorTrackingE2e.variations as WizardE2eVariation[],
  [Program.WarehouseSource]:
    warehouseSourceE2e.variations as WizardE2eVariation[],
};

/** The e2e profile for a program, or the happy-path default if none is set. */
export function profileFor(program: ProgramId): WizardE2eProfile {
  return PROFILES[program] ?? DEFAULT_E2E_PROFILE;
}

/** Whether a program has an explicit (non-default) e2e profile. */
export function hasProfile(program: ProgramId): boolean {
  return program in PROFILES;
}

/**
 * The switchboard variations to snapshot for a program — one run each. Falls
 * back to the single no-override baseline when a program declares none.
 */
export function variationsFor(program: ProgramId): WizardE2eVariation[] {
  return VARIATIONS[program] ?? [DEFAULT_E2E_VARIATION];
}

/** Env-var inputs a run may layer over a program's declared profile. */
export interface E2eProfileOverrides {
  /** `E2E_NOTICE` — `keep` or `decline`. Anything else is ignored. */
  notice?: string;
  /**
   * Extra `askAnswers` rules, from `E2E_ANSWERS_FILE`. Merged *before* the
   * profile's own rules, so the runner can re-route one question per app
   * without editing the program's e2e.json.
   */
  extraAskAnswers?: AskAnswerRule[];
  /** Env map used to expand `${VAR}` inside every rule value. */
  env?: Record<string, string | undefined>;
}

/**
 * Fold a run's env-var inputs into a profile, once, at load.
 *
 * `decideE2eAction` is documented pure — same (state, profile) in, same
 * decision out. Reading `process.env` inside it would break that and make the
 * flow-snapshot test depend on the shell it runs in. So every env input is
 * resolved here instead, at the one point that already knows the run's
 * configuration. In an e2e run the environment is fixed when the wizard child
 * process starts, so resolving at load and resolving at answer time produce the
 * same answers.
 */
export function resolveE2eProfile(
  base: WizardE2eProfile,
  overrides: E2eProfileOverrides = {},
): WizardE2eProfile {
  const env = overrides.env ?? {};
  const rules = [
    ...(overrides.extraAskAnswers ?? []),
    ...(base.askAnswers ?? []),
  ];
  const resolved: WizardE2eProfile = {
    ...base,
    ...(rules.length > 0
      ? {
          // Spread the rule: interpolation only rewrites `value`, and dropping
          // any other field here would silently unset a rule's `secret` flag.
          askAnswers: rules.map((rule) => ({
            ...rule,
            value: interpolateEnv(rule.value, env),
          })),
        }
      : {}),
  };
  if (overrides.notice === 'keep' || overrides.notice === 'decline') {
    resolved.notice = overrides.notice;
  }
  return resolved;
}

/** Expand `${VAR}` from `env`. An unset var becomes an empty string. */
function interpolateEnv(
  value: string,
  env: Record<string, string | undefined>,
): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, name: string) => env[name] ?? '',
  );
}
