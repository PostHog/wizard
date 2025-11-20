/* React wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { enableDebugLogs } from '../utils/debug';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';
import { getPackageVersion } from '../utils/package-json';
import clack from '../utils/clack';

/**
 * React framework configuration for the universal agent runner.
 */
const REACT_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'React',
    integration: Integration.react,
    docsUrl: 'https://posthog.com/docs/libraries/react',
    abortMessage:
      'This wizard uses an LLM agent to intelligently modify your project. Please view the docs to setup React manually instead: https://posthog.com/docs/libraries/react',
  },

  detection: {
    packageName: 'react',
    packageDisplayName: 'React',
    getVersion: (packageJson: any) => getPackageVersion('react', packageJson),
  },

  environment: {
    uploadToHosting: true,
    expectedEnvVarSuffixes: ['POSTHOG_KEY', 'POSTHOG_HOST'],
  },

  analytics: {
    getTags: () => ({}),
  },

  prompts: {},

  ui: {
    welcomeMessage: 'PostHog React wizard (agent-powered)',
    spinnerMessage:
      'Writing your PostHog setup with events, error capture and more...',
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => {
      return [
        `Analyzed your React project structure`,
        `Created and configured PostHog provider`,
        `Integrated PostHog into your application`,
      ];
    },
    getOutroNextSteps: () => {
      return [
        'Start your development server to see PostHog in action',
        'Visit your PostHog dashboard to see incoming events',
      ];
    },
  },
};

/**
 * React wizard powered by the universal agent runner.
 */
export async function runReactWizardAgent(
  options: WizardOptions,
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  clack.log.info(
    '🧙 The wizard has chosen you to try the next-generation agent integration for React.\n\nStand by for the good stuff, and let me know how it goes:\n\ndanilo@posthog.com',
  );

  await runAgentWizard(REACT_AGENT_CONFIG, options);
}
