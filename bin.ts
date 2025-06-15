#!/usr/bin/env node
import { satisfies } from 'semver';
import { red } from './src/utils/logging';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

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

yargs(hideBin(process.argv))
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
      default: false,
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
      void runWizard(argv as unknown as WizardOptions);
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
          void runMCPInstall(
            argv as unknown as { signup: boolean; region?: CloudRegion },
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
  .wrap(yargs.terminalWidth()).argv;
