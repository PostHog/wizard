import { dispatchProgram } from './factories/shared.js';
import { selfDrivingConfig } from '@store/programs';
import { skillProgramOptions } from './skill-program-options.js';
import type { Command } from './command.js';

export const selfDrivingCommand: Command = {
  name: 'self-driving',
  description: selfDrivingConfig.description,
  options: {
    ...skillProgramOptions,
    integrate: {
      describe:
        'Integrate the PostHog SDK first, then set up Self-driving — skips the integration prompt and logs you in via OAuth (no "create an account?" question). Use when the project isn\'t set up yet but you already have a PostHog account.',
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
        '`self-driving` cannot run with --signup. Just run `wizard ' +
          'self-driving`: when your project has no PostHog, it asks whether ' +
          'you already have an account and offers to create one for you ' +
          '(no flag needed).',
      );
    }
    // A controlling parent on the socket answers those steps, so `--ci` is
    // fine when a control socket is attached.
    if (argv.ci && !argv.controlSocket) {
      throw new Error(
        '`self-driving` cannot run in CI mode — it requires interactive steps ' +
          '(GitHub connect, issue-tracker selection, custom-scout approval).',
      );
    }
    return true;
  },
  handler: (argv) => dispatchProgram(selfDrivingConfig, argv),
};
