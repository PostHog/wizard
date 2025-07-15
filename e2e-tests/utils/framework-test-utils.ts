import { KEYS } from './index';
import type { WizardStep } from './framework-test-types';

export const DEFAULT_WIZARD_STEPS: WizardStep[] = [
  {
    name: 'region',
    waitFor: 'Select your PostHog Cloud region',
    response: [KEYS.ENTER],
    responseWaitFor: 'US',
  },
  // {
  //   name: 'uncommitted',
  //   waitFor: 'You have uncommitted or untracked files in your repo:',
  //   response: [KEYS.DOWN, KEYS.ENTER],
  //   timeout: 2000,
  //   optional: true,
  // },
  {
    name: 'mcp',
    waitFor:
      'Would you like to install the PostHog MCP server to use PostHog in your editor?',
    response: [KEYS.DOWN, KEYS.ENTER],
    responseWaitFor: 'No',
  },
  {
    name: 'completion',
    waitFor: 'Successfully installed PostHog!',
    timeout: 2000,
  },
];
