import { headlessOption, regionOption } from '@lib/headless-mode';
import { AGENT_SKILL_STEPS } from '@lib/programs/agent-skill/steps';
import { detectPostHogIntegration } from '@lib/programs/posthog-integration/detect';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration/index';
import type { ProgramConfig, ProgramStep } from '@lib/programs/program-step';
import type { WizardSession } from '@lib/wizard-session';
import { FEATURE_FLAGS_PROMPTS, FEATURE_FLAGS_REPORT_FILE } from './prompts.js';

const FEATURE_FLAGS_DOCS_URL = 'https://posthog.com/docs/feature-flags';

const DETECT_FRAMEWORK_STEP: ProgramStep = {
  id: 'detect',
  label: 'Detecting framework',
  onReady: detectPostHogIntegration,
};

export const featureFlagsConfig: ProgramConfig = {
  command: 'feature-flags',
  description: 'Set up example PostHog feature flags',
  id: 'feature-flags',
  agentFlow: 'feature-flags',
  agentPrompts: FEATURE_FLAGS_PROMPTS,
  steps: [DETECT_FRAMEWORK_STEP, ...AGENT_SKILL_STEPS],
  reportFile: FEATURE_FLAGS_REPORT_FILE,
  cliOptions: { ...headlessOption, ...regionOption },
  run: {
    integrationLabel: 'feature-flags',
    successMessage: `Feature flags wired in! View the report at ./${FEATURE_FLAGS_REPORT_FILE}`,
    reportFile: FEATURE_FLAGS_REPORT_FILE,
    docsUrl: FEATURE_FLAGS_DOCS_URL,
    spinnerMessage: 'Setting up your first feature flags...',
    estimatedDurationMinutes: 5,
    buildOutroNextSteps: () => ({
      heading: 'Next steps',
      items: [
        `Read ./${FEATURE_FLAGS_REPORT_FILE} for each flag's link and call site`,
        'Enable the example flags in PostHog when you are ready to roll them out',
      ],
    }),
  },

  ciPreRun: async (session: WizardSession): Promise<void> => {
    await posthogIntegrationConfig.ciPreRun?.(session);
    if (session.integration) session.skillId = session.integration;
  },
};
