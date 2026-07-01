import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun } from '@lib/agent/agent-runner';
import type { WizardSession } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import { ERROR_TRACKING_UPLOAD_SOURCE_MAPS_PROGRAM } from './steps.js';
import {
  buildSourceMapsUploadPrompt,
  SOURCE_MAPS_DETECTION_FAILED_PROMPT,
} from './prompt.js';
import {
  SOURCE_MAPS_ABORT_CASES,
  SOURCE_MAPS_CONTEXT_KEYS,
  type SkillVariant,
} from './detect.js';
import { getContentBlocks } from './content/index.js';
import { getUiHostFromHost } from '@utils/urls';
import { getUI } from '@ui';

const REPORT_FILE = 'posthog-source-maps-report.md';
/** Manual source-map upload guide. Shown in the outro and on the
 *  detect-screen dead ends so an unsupported/native stack still has a path
 *  forward instead of an exit. */
export const SOURCE_MAPS_DOCS_URL =
  'https://posthog.com/docs/error-tracking/upload-source-maps';
const DOCS_URL = SOURCE_MAPS_DOCS_URL;

export const errorTrackingUploadSourceMapsConfig: ProgramConfig = {
  command: 'upload-source-maps',
  description: 'Upload source maps to PostHog Error Tracking',
  id: 'error-tracking-upload-source-maps',
  requiresAi: true,
  steps: ERROR_TRACKING_UPLOAD_SOURCE_MAPS_PROGRAM,
  reportFile: REPORT_FILE,
  getContentBlocks,
  requires: ['posthog-integration'],

  run: (_session: WizardSession): Promise<ProgramRun> => {
    // Read the picked project LIVE at prompt-build time, not here: the picker
    // screen runs AFTER this run config is resolved (post-auth), and the store
    // forks the session reference, so the `session` passed in never sees the
    // choice. getUI().getFrameworkContext reads the live store session.
    const readSelection = () => {
      const variant = getUI().getFrameworkContext(
        SOURCE_MAPS_CONTEXT_KEYS.selectedVariant,
      ) as SkillVariant | undefined;
      const displayName = getUI().getFrameworkContext(
        SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName,
      ) as string | undefined;
      const projectPath = getUI().getFrameworkContext(
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

        const uiHost = getUiHostFromHost(ctx.host).replace(/\/$/, '');

        return buildSourceMapsUploadPrompt({
          displayName,
          variant,
          skillId,
          projectPath,
          projectId: ctx.projectId,
          host: ctx.host,
          settingsUrl: `${uiHost}/project/${ctx.projectId}/settings/user-api-keys`,
          uiHost,
        });
      },

      postRun: () => {
        // Stash a hint for the outro about what variant we shipped.
        const { variant } = readSelection();
        if (variant) {
          getUI().setFrameworkContext('sourceMapsCompletedVariant', variant);
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

export { ERROR_TRACKING_UPLOAD_SOURCE_MAPS_PROGRAM } from './steps.js';
export {
  detectSourceMapsPrerequisites,
  SOURCE_MAPS_ABORT_CASES,
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANT_DISPLAY_NAME,
  type SkillVariant,
  type SourceMapsDetectError,
} from './detect.js';
