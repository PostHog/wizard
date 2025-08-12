#!/usr/bin/env node
import { satisfies } from 'semver';
import { red } from './src/utils/logging';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';

const NODE_VERSION_RANGE = '>=18.17.0';

// Have to run this above the other imports because they are importing clack that
// has the problematic imports.
if (!satisfies(process.version, NODE_VERSION_RANGE)) {
  red(
    `PostHog wizard requires Node.js ${NODE_VERSION_RANGE}. You are using Node.js ${process.version}. Please upgrade your Node.js version.`,
  );
  process.exit(1);
}

import { runMCPInstall, runMCPRemove } from './src/mcp';
import type { CloudRegion, WizardOptions } from './src/utils/types';
import { runWizard } from './src/run';
import { runEventSetupWizard } from './src/nextjs/event-setup';
import {
  readEnvironment,
  isNonInteractiveEnvironment,
} from './src/utils/environment';
import path from 'path';
import clack from './src/utils/clack';

if (isNonInteractiveEnvironment()) {
  clack.intro(chalk.inverse(`PostHog Wizard`));

  clack.log.error(
    'This installer requires an interactive terminal (TTY) to run.\n' +
      'It appears you are running in a non-interactive environment.\n' +
      'Please run the wizard in an interactive terminal.',
  );
  process.exit(1);
}

if (process.env.NODE_ENV === 'test') {
  void (async () => {
    try {
      const { server } = await import('./e2e-tests/mocks/server.js');
      server.listen({
        onUnhandledRequest: 'bypass',
      });
    } catch (error) {
      // Mock server import failed - this can happen during non-E2E tests
    }
  })();
}

yargs(hideBin(process.argv))
  .env('POSTHOG_WIZARD')
  // global options
  .options({
    debug: {
      default: false,
      describe: 'Enable verbose logging\nenv: POSTHOG_WIZARD_DEBUG',
      type: 'boolean',
    },
    region: {
      describe: 'PostHog cloud region\nenv: POSTHOG_WIZARD_REGION',
      choices: ['us', 'eu'],
      type: 'string',
    },
    default: {
      default: true,
      describe:
        'Use default options for all prompts\nenv: POSTHOG_WIZARD_DEFAULT',
      type: 'boolean',
    },
    signup: {
      default: false,
      describe:
        'Create a new PostHog account during setup\nenv: POSTHOG_WIZARD_SIGNUP',
      type: 'boolean',
    },
  })
  .command(
    ['$0'],
    'Run the PostHog setup wizard',
    (yargs) => {
      return yargs.options({
        'force-install': {
          default: false,
          describe:
            'Force install packages even if peer dependency checks fail\nenv: POSTHOG_WIZARD_FORCE_INSTALL',
          type: 'boolean',
        },
        'install-dir': {
          describe:
            'Directory to install PostHog in\nenv: POSTHOG_WIZARD_INSTALL_DIR',
          type: 'string',
        },
        integration: {
          describe: 'Integration to set up',
          choices: ['nextjs', 'astro', 'react', 'svelte', 'react-native'],
          type: 'string',
        },
      });
    },
    (argv) => {
      const options = { ...argv };
      void runWizard(options as unknown as WizardOptions);
    },
  )
  .command(
    'event-setup',
    'Run the event setup wizard',
    (yargs) => {
      return yargs.options({
        'install-dir': {
          describe:
            'Directory to run the wizard in\nenv: POSTHOG_WIZARD_INSTALL_DIR',
          type: 'string',
        },
      });
    },
    (argv) => {
      const finalArgs = {
        ...argv,
        ...readEnvironment(),
      } as any;

      let resolvedInstallDir: string;
      if (finalArgs.installDir) {
        if (path.isAbsolute(finalArgs.installDir)) {
          resolvedInstallDir = finalArgs.installDir;
        } else {
          resolvedInstallDir = path.join(process.cwd(), finalArgs.installDir);
        }
      } else {
        resolvedInstallDir = process.cwd();
      }

      const wizardOptions: WizardOptions = {
        debug: finalArgs.debug ?? false,
        installDir: resolvedInstallDir,
        cloudRegion: finalArgs.region as CloudRegion | undefined,
        default: finalArgs.default ?? false,
        signup: finalArgs.signup ?? false,
        forceInstall: false,
      };

      void runEventSetupWizard(wizardOptions);
    },
  )
  .command('mcp <command>', 'MCP server management commands', (yargs) => {
    return yargs
      .command(
        'add',
        'Install PostHog MCP server to supported clients',
        (yargs) => {
          return yargs.options({});
        },
        (argv) => {
          const options = { ...argv };
          void runMCPInstall(
            options as unknown as { signup: boolean; region?: CloudRegion },
          );
        },
      )
      .command(
        'remove',
        'Remove PostHog MCP server from supported clients',
        (yargs) => {
          return yargs.options({});
        },
        () => {
          void runMCPRemove();
        },
      )
      .demandCommand(1, 'You must specify a subcommand (add or remove)')
      .help();
  })
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY ? yargs.terminalWidth() : 80).argv;
