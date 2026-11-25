import { runWizard, runWizardCI, wantsDiscoveryTest } from '@cli/runners';
import { config as selfDrivingConfig } from '@programs/self-driving';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const selfDrivingCommand: Command = {
  name: 'self-driving',
  description: selfDrivingConfig.description,
  options: {
    ...skillProgramOptions,
    integrate: {
      describe:
        'Integrate the PostHog SDK first, then set up Self-driving. Skips the integration prompt and opens PostHog in the browser to log in or sign up.',
      type: 'boolean',
      default: false,
    },
    ...(selfDrivingConfig.cliOptions ?? {}),
  },
  check: (argv) => {
    // Test discovery mode only prints, so no mode it would refuse matters.
    if (wantsDiscoveryTest(argv)) return true;
    // self-driving is fully interactive, so --ci is rejected before the
    // TUI/agent loop spins up rather than failing late (a stalled
    // `wizard_ask` with no bridge under --ci).
    if (argv.ci) {
      throw new Error(
        '`self-driving` cannot run in CI mode — it requires interactive steps ' +
          '(GitHub connect, issue-tracker selection, custom-scout approval).',
      );
    }
    return true;
  },
  handler: (argv) => {
    const extras =
      selfDrivingConfig.mapCliOptions?.(argv as Record<string, unknown>) ?? {};
    const options = { ...argv, ...extras };
    if (options.ci) {
      runWizardCI(selfDrivingConfig, options);
    } else {
      runWizard(selfDrivingConfig, options);
    }
  },
};
