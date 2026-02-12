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
import { isNonInteractiveEnvironment } from './src/utils/environment';
import clack from './src/utils/clack';

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
    'local-mcp': {
      default: false,
      describe:
        'Use local MCP server at http://localhost:8787/mcp\nenv: POSTHOG_WIZARD_LOCAL_MCP',
      type: 'boolean',
    },
    ci: {
      default: false,
      describe:
        'Enable CI mode for non-interactive execution\nenv: POSTHOG_WIZARD_CI',
      type: 'boolean',
    },
    'api-key': {
      describe:
        'PostHog personal API key (phx_xxx) for authentication\nenv: POSTHOG_WIZARD_API_KEY',
      type: 'string',
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
          choices: [
            'nextjs',
            'astro',
            'react',
            'svelte',
            'react-native',
            'tanstack-router',
            'tanstack-start',
          ],
          type: 'string',
        },
        menu: {
          default: false,
          describe:
            'Show menu for manual integration selection instead of auto-detecting\nenv: POSTHOG_WIZARD_MENU',
          type: 'boolean',
        },
        benchmark: {
          default: false,
          describe:
            'Run in benchmark mode with per-phase token tracking\nenv: POSTHOG_WIZARD_BENCHMARK',
          type: 'boolean',
        },
      });
    },
    (argv) => {
      const options = { ...argv };

      // CI mode validation and TTY check
      if (options.ci) {
        // Validate required CI flags
        if (!options.region) {
          clack.intro(chalk.inverse(`PostHog Wizard`));
          clack.log.error('CI mode requires --region (us or eu)');
          process.exit(1);
        }
        if (!options.apiKey) {
          clack.intro(chalk.inverse(`PostHog Wizard`));
          clack.log.error(
            'CI mode requires --api-key (personal API key phx_xxx)',
          );
          process.exit(1);
        }
        if (!options.installDir) {
          clack.intro(chalk.inverse(`PostHog Wizard`));
          clack.log.error(
            'CI mode requires --install-dir (directory to install PostHog in)',
          );
          process.exit(1);
        }
      } else if (isNonInteractiveEnvironment()) {
        // Original TTY error for non-CI mode
        clack.intro(chalk.inverse(`PostHog Wizard`));
        clack.log.error(
          'This installer requires an interactive terminal (TTY) to run.\n' +
            'It appears you are running in a non-interactive environment.\n' +
            'Please run the wizard in an interactive terminal.\n\n' +
            'For CI/CD environments, use --ci mode:\n' +
            '  npx @posthog/wizard --ci --region us --api-key phx_xxx',
        );
        process.exit(1);
      }

      void runWizard(options as unknown as WizardOptions);
    },
  )
  .command('mcp <command>', 'MCP server management commands', (yargs) => {
    return yargs
      .command(
        'add',
        'Install PostHog MCP server to supported clients',
        (yargs) => {
          return yargs.options({
            local: {
              default: false,
              describe:
                'Add local development MCP server (http://localhost:8787)',
              type: 'boolean',
            },
          });
        },
        (argv) => {
          const options = { ...argv };
          void runMCPInstall(
            options as unknown as {
              signup: boolean;
              region?: CloudRegion;
              local?: boolean;
              debug?: boolean;
            },
          );
        },
      )
      .command(
        'remove',
        'Remove PostHog MCP server from supported clients',
        (yargs) => {
          return yargs.options({
            local: {
              default: false,
              describe:
                'Remove local development MCP server (http://localhost:8787)',
              type: 'boolean',
            },
          });
        },
        (argv) => {
          const options = { ...argv };
          void runMCPRemove(options as { local?: boolean });
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
