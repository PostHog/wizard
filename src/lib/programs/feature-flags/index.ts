import type { AbortCase } from '@lib/agent/agent-runner';
import { ErrorCodes } from '@lib/errors';
import { createSkillProgram } from '@lib/programs/agent-skill/index';

const FEATURE_FLAGS_REPORT_FILE = 'posthog-feature-flags-report.md';

/**
 * `[ABORT]` reasons the feature-flags-setup skill emits when the project
 * can't be instrumented. Kept in sync with the stop conditions in the
 * skill's `description.md` (context-mill `context/skills/feature-flags-setup`).
 */
export const FEATURE_FLAGS_ABORT_CASES: AbortCase[] = [
  {
    match: /^unsupported stack for feature flags$/i,
    errorCode: ErrorCodes.DetectUnsupportedPlatform,
    message: 'Unsupported stack for wizard feature-flags',
    body:
      'This program instruments Next.js App Router apps only (`app/` directory + ' +
      'the `next` package). Other frameworks, Pages Router, and backend-only ' +
      'packages are out of scope — stack detection is deliberately narrow. ' +
      'See https://posthog.com/docs/libraries/next-js and ' +
      'https://posthog.com/docs/feature-flags/bootstrapping for the pattern, ' +
      'or run `npx @posthog/wizard` for a general PostHog install.',
  },
  {
    match: /^no posthog project credentials$/i,
    message: 'No PostHog project credentials',
    body:
      'A project API key (phc_…) is required to evaluate flags and to create ' +
      'one in your project. Re-run after authenticating, or set ' +
      'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN in the app env.',
  },
  {
    match: /^could not create the feature flag$/i,
    message: 'Could not create the feature flag',
    body:
      'The install needs feature_flag:write to create a 0% boolean flag after ' +
      'you confirm a UI path. Re-run after granting that scope, or skip gating ' +
      'and keep the SDK install. The wizard does not leave a half-created flag ' +
      'or ask you to create one by hand.',
  },
];

/**
 * `wizard feature-flags` — flat skill command.
 *
 * Next.js App Router flags install: server-side `evaluateFlags()`
 * bootstrapped into the client. Optional 0% boolean flag + additive
 * UI path after one confirm. Skip is first: no new flag, no UI change.
 * Distinct from `wizard audit feature-flags` (read-only, post-hoc) and
 * from the default `wizard` install (product analytics).
 *
 * Flat while install-and-instrument is the only action. A second leaf
 * (e.g. local-eval, experiments) would restructure into a family later —
 * not pre-emptively.
 *
 * The mill skill is the source of truth for steps. This prompt only points
 * at it — do not restate the playbook here.
 */
export const featureFlagsConfig = createSkillProgram({
  skillId: 'feature-flags-setup',
  command: 'feature-flags',
  id: 'feature-flags',
  description:
    'Add PostHog feature flags (Next.js App Router: server eval + client bootstrap)',
  integrationLabel: 'feature-flags',
  customPrompt:
    'Run the `feature-flags-setup` skill end-to-end. Do not contradict it. ' +
    `The final report is written to ./${FEATURE_FLAGS_REPORT_FILE}.`,
  successMessage: `Feature flags configured! View the report at ./${FEATURE_FLAGS_REPORT_FILE}`,
  reportFile: FEATURE_FLAGS_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/feature-flags/start-here',
  spinnerMessage: 'Setting up feature flags...',
  estimatedDurationMinutes: 6,
  abortCases: FEATURE_FLAGS_ABORT_CASES,
});
