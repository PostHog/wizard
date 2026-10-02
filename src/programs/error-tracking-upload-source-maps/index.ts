import type { ProgramConfig } from '../program-step';
import type { ProgramRun } from '../program-run';
import type { ProgramSession } from '../program-session';
import { OutroKind } from '@shared/outro';
import type { RunnerContext } from '../runner-context';
import {
  buildSourceMapsUploadPrompt,
  SOURCE_MAPS_DETECTION_FAILED_PROMPT,
} from './prompt.js';
import {
  SOURCE_MAPS_ABORT_CASES,
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANTS_REQUIRING_POSTHOG_CLI,
  type SkillVariant,
} from './detect.js';
import { preinstallPostHogCliOnce } from '../shared/posthog-cli-preinstall';

const REPORT_FILE = 'posthog-source-maps-report.md';
const DOCS_URL = 'https://posthog.com/docs/error-tracking/upload-source-maps';

/**
 * Pre-install posthog-cli for variants that need a machine-global copy
 * (`VARIANTS_REQUIRING_POSTHOG_CLI`). See `preinstallPostHogCliOnce` for the
 * once-per-process guard and the warn-don't-fail handling.
 */
function ensurePostHogCli(
  variant: SkillVariant,
  log: RunnerContext['log'],
): void {
  preinstallPostHogCliOnce(
    'source maps posthog-cli preinstall failed',
    { variant },
    log,
  );
}

export const config: ProgramConfig = {
  command: 'upload-source-maps',
  description: 'Upload source maps to PostHog Error Tracking',
  id: 'error-tracking-upload-source-maps',
  // No health-check screen in the TUI flow; the run skips the readiness check.
  healthCheck: false,
  reportFile: REPORT_FILE,
  requires: ['posthog-integration'],

  run: (
    _session: ProgramSession,
    runner: RunnerContext,
  ): Promise<ProgramRun> => {
    // Read the picked project LIVE at prompt-build time, not here: the picker
    // screen runs AFTER this run config is resolved (post-auth), and the store
    // forks the session reference, so the `session` passed in never sees the
    // choice. The runner reads the live store session.
    const readSelection = () => {
      const variant = runner.getFrameworkContext(
        SOURCE_MAPS_CONTEXT_KEYS.selectedVariant,
      ) as SkillVariant | undefined;
      const displayName = runner.getFrameworkContext(
        SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName,
      ) as string | undefined;
      const projectPath = runner.getFrameworkContext(
        SOURCE_MAPS_CONTEXT_KEYS.selectedPath,
      ) as string | undefined;
      const skillId = variant
        ? `error-tracking-upload-source-maps-${variant}`
        : undefined;
      return { variant, displayName, projectPath, skillId };
    };

    return Promise.resolve({
      integrationLabel: 'error-tracking-upload-source-maps',
      // Skill is installed by the agent (after the API-key choice is made)
      // rather than pre-installed by the runner, so leave skillId unset.
      successMessage: 'Source maps wired up!',
      reportFile: REPORT_FILE,
      docsUrl: DOCS_URL,
      spinnerMessage: 'Wiring up source maps...',
      estimatedDurationMinutes: 3,
      abortCases: SOURCE_MAPS_ABORT_CASES,
      // The flow parks on wizard_ask while the user does slow work — create
      // a personal API key in the browser (STEP 1), or run a production
      // build, trigger the test error, and check Error Tracking (STEP 8).
      // The 5-minute default cancels the question mid-task and the agent
      // wraps up to the outro, so give these answers half an hour.
      askTimeoutMs: 30 * 60 * 1000,

      customPrompt: (ctx) => {
        const { variant, displayName, projectPath, skillId } = readSelection();
        if (!skillId || !variant) {
          // No project was selected — abort with a structured signal so the
          // runner renders a friendly outro.
          return SOURCE_MAPS_DETECTION_FAILED_PROMPT;
        }

        if (VARIANTS_REQUIRING_POSTHOG_CLI.has(variant))
          ensurePostHogCli(variant, runner.log);

        const uiHost = ctx.host.appHost.replace(/\/$/, '');

        return buildSourceMapsUploadPrompt({
          displayName,
          variant,
          skillId,
          projectPath,
          projectId: ctx.projectId,
          host: ctx.host.apiHost,
          settingsUrl: `${uiHost}/project/${ctx.projectId}/settings/user-api-keys`,
          uiHost,
          reportFile: REPORT_FILE,
        });
      },

      postRun: () => {
        // Stash a hint for the outro about what variant we shipped.
        const { variant } = readSelection();
        if (variant) {
          runner.setFrameworkContext('sourceMapsCompletedVariant', variant);
        }
        return Promise.resolve();
      },

      buildOutroData: () => {
        // SourceMapsOutroScreen renders static "what we did + how it works"
        // guidance, so no per-run `changes` list is needed here.
        return {
          kind: OutroKind.Success as const,
          message: 'Source maps wired up!',
          reportFile: REPORT_FILE,
          docsUrl: DOCS_URL,
        };
      },
    });
  },
};

export {
  detectSourceMapsPrerequisites,
  SOURCE_MAPS_ABORT_CASES,
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANT_DISPLAY_NAME,
  VARIANTS_REQUIRING_POSTHOG_CLI,
  MANUAL_SDK_VARIANTS,
  type SkillVariant,
  type SourceMapsDetectError,
} from './detect.js';

export {
  detectSourceMapsProjects,
  type DetectedProject,
  type DetectionReport,
} from './detect-agentic.js';
