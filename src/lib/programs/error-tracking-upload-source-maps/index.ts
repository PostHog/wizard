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

const REPORT_FILE = 'posthog-source-maps-report.md';
const DOCS_URL = 'https://posthog.com/docs/error-tracking/upload-source-maps';

export const errorTrackingUploadSourceMapsConfig: ProgramConfig = {
  command: 'upload-source-maps',
  description: 'Upload source maps to PostHog Error Tracking',
  id: 'error-tracking-upload-source-maps',
  requiresAi: true,
  steps: ERROR_TRACKING_UPLOAD_SOURCE_MAPS_PROGRAM,
  reportFile: REPORT_FILE,
  getContentBlocks,
  requires: ['posthog-integration'],

  run: (session: WizardSession): Promise<ProgramRun> => {
    const variant = session.frameworkContext[
      SOURCE_MAPS_CONTEXT_KEYS.skillVariant
    ] as SkillVariant | undefined;
    const displayName = session.frameworkContext[
      SOURCE_MAPS_CONTEXT_KEYS.displayName
    ] as string | undefined;

    const skillId = variant
      ? `error-tracking-upload-source-maps-${variant}`
      : undefined;

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

      customPrompt: (ctx) => {
        if (!skillId || !variant) {
          // Detection failed but the user got past the intro somehow.
          // Tell the agent to abort with a structured signal so the runner
          // renders a friendly outro.
          return SOURCE_MAPS_DETECTION_FAILED_PROMPT;
        }

        const uiHost = getUiHostFromHost(ctx.host).replace(/\/$/, '');

        return buildSourceMapsUploadPrompt({
          displayName,
          variant,
          skillId,
          projectId: ctx.projectId,
          host: ctx.host,
          settingsUrl: `${uiHost}/project/${ctx.projectId}/settings/user-api-keys`,
          uiHost,
        });
      },

      postRun: (sess) => {
        // Stash a hint for the outro about what variant we shipped.
        if (variant) {
          sess.frameworkContext['sourceMapsCompletedVariant'] = variant;
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
