import type { ProgramConfig } from '../program-step';
import type { ProgramRun } from '../program-run';
import type { ProgramRunHost } from '../host-capabilities';
import { OutroKind } from '@agent';
import {
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANTS_REQUIRING_POSTHOG_CLI,
  type SkillVariant,
} from './detect.js';
import {
  resolveSourceMapsRunDefinition,
  SOURCE_MAPS_DOCS_URL,
  SOURCE_MAPS_REPORT_FILE,
} from '../resolve-run-definition';
import { preinstallPostHogCliOnce } from '../shared/posthog-cli-preinstall';

/**
 * Pre-install posthog-cli for variants that need a machine-global copy
 * (`VARIANTS_REQUIRING_POSTHOG_CLI`). See `preinstallPostHogCliOnce` for the
 * once-per-process guard and the warn-don't-fail handling.
 */
function ensurePostHogCli(
  variant: SkillVariant,
  warn: ProgramRunHost['warn'],
): void {
  preinstallPostHogCliOnce(
    'source maps posthog-cli preinstall failed',
    { variant },
    warn,
  );
}

export const errorTrackingUploadSourceMapsConfig: ProgramConfig = {
  command: 'upload-source-maps',
  description: 'Upload source maps to PostHog Error Tracking',
  id: 'error-tracking-upload-source-maps',
  requiresAi: true,
  reportFile: SOURCE_MAPS_REPORT_FILE,
  requires: ['posthog-integration'],

  run: (_session, host: ProgramRunHost): Promise<ProgramRun> => {
    // Read the picked project LIVE at prompt-build time, not here: the picker
    // screen runs AFTER this run config is resolved (post-auth), and the store
    // forks the session reference, so the `session` passed in never sees the
    // choice. The host reads the live store session.
    const readSelection = () => {
      const variant = host.getFrameworkContext(
        SOURCE_MAPS_CONTEXT_KEYS.selectedVariant,
      ) as SkillVariant | undefined;
      const displayName = host.getFrameworkContext(
        SOURCE_MAPS_CONTEXT_KEYS.selectedDisplayName,
      ) as string | undefined;
      const projectPath = host.getFrameworkContext(
        SOURCE_MAPS_CONTEXT_KEYS.selectedPath,
      ) as string | undefined;
      return { variant, displayName, projectPath };
    };

    return Promise.resolve({
      ...resolveSourceMapsRunDefinition(),

      customPrompt: (ctx) => {
        // The legacy picker writes after `run()` resolves, so read its live
        // selection at prompt time; callable programs pass it as plain data.
        const selection = readSelection();
        const { variant } = selection;
        if (variant && VARIANTS_REQUIRING_POSTHOG_CLI.has(variant))
          ensurePostHogCli(variant, (message) => host.warn(message));
        const prompt = resolveSourceMapsRunDefinition(selection).customPrompt;
        if (!prompt) throw new Error('Source maps run has no prompt');
        return prompt(ctx);
      },

      postRun: () => {
        // Stash a hint for the outro about what variant we shipped.
        const { variant } = readSelection();
        if (variant) {
          host.setFrameworkContext('sourceMapsCompletedVariant', variant);
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

export {
  detectSourceMapsPrerequisites,
  SOURCE_MAPS_ABORT_CASES,
  SOURCE_MAPS_CONTEXT_KEYS,
  VARIANT_DISPLAY_NAME,
  MANUAL_SDK_VARIANTS,
  type SkillVariant,
  type SourceMapsDetectError,
} from './detect.js';
