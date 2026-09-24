import type { ProgramConfig } from '@programs/program-step';
import type { ProgramRun } from '@programs/program-run';
import type { WizardSession } from '@lib/wizard-session';
import { OutroKind } from '@lib/wizard-session';
import { ERROR_TRACKING_UPLOAD_SOURCE_MAPS_PROGRAM } from './steps.js';
import {
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANTS_REQUIRING_POSTHOG_CLI,
  type SkillVariant,
} from './detect.js';
import {
  resolveSourceMapsRunDefinition,
  SOURCE_MAPS_DOCS_URL,
  SOURCE_MAPS_REPORT_FILE,
} from '@programs/resolve-run-definition';
import { getContentBlocks } from '../../ui/tui/decks/error-tracking-upload-source-maps/index.js';
import { getUI } from '@ui';
import { preinstallPostHogCliOnce } from '@programs/shared/posthog-cli-preinstall';

/**
 * Pre-install posthog-cli for variants that need a machine-global copy
 * (`VARIANTS_REQUIRING_POSTHOG_CLI`). See `preinstallPostHogCliOnce` for the
 * once-per-process guard and the warn-don't-fail handling.
 */
function ensurePostHogCli(variant: SkillVariant): void {
  preinstallPostHogCliOnce('source maps posthog-cli preinstall failed', {
    variant,
  });
}

export const errorTrackingUploadSourceMapsConfig: ProgramConfig = {
  command: 'upload-source-maps',
  description: 'Upload source maps to PostHog Error Tracking',
  id: 'error-tracking-upload-source-maps',
  requiresAi: true,
  steps: ERROR_TRACKING_UPLOAD_SOURCE_MAPS_PROGRAM,
  reportFile: SOURCE_MAPS_REPORT_FILE,
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
      return { variant, displayName, projectPath };
    };

    return Promise.resolve({
      ...resolveSourceMapsRunDefinition(),

      customPrompt: (ctx) => {
        const selection = readSelection();
        const { variant } = selection;
        if (variant && VARIANTS_REQUIRING_POSTHOG_CLI.has(variant))
          ensurePostHogCli(variant);
        return resolveSourceMapsRunDefinition(selection).customPrompt!(ctx);
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
          reportFile: SOURCE_MAPS_REPORT_FILE,
          docsUrl: SOURCE_MAPS_DOCS_URL,
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
  MANUAL_SDK_VARIANTS,
  type SkillVariant,
  type SourceMapsDetectError,
} from './detect.js';
