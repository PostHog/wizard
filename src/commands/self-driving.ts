import { runWizard, runWizardCI } from '@lib/runners';
import { selfDrivingConfig } from '@lib/programs/self-driving/index';
import { skillProgramOptions } from './skill-program-options';
import type { Command } from './command';

export const selfDrivingCommand: Command = {
  name: 'self-driving',
  description: selfDrivingConfig.description,
  options: {
    ...skillProgramOptions,
    integrate: {
      describe:
        'Integrate the PostHog SDK first, then set up Self-driving — skips the "do you already have PostHog?" question. Use when the project isn\'t set up yet.',
      type: 'boolean',
      default: false,
    },
    ...(selfDrivingConfig.cliOptions ?? {}),
  },
  check: (argv) => {
    // self-driving builds on an existing integration and is fully interactive,
    // so the modes that break it are rejected before the TUI/agent loop spins
    // up rather than failing late (a 403 on the first MCP probe under --signup,
    // or a stalled `wizard_ask` with no bridge under --ci).
    if (argv.signup) {
      throw new Error(
        '`self-driving` cannot run with --signup. It builds on an existing ' +
          'PostHog integration — run the base `wizard` to create your account ' +
          'and set up PostHog first, then run `wizard self-driving`.',
      );
    }
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
