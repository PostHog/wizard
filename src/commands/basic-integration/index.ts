import { isNonInteractiveEnvironment } from '@utils/environment';
import { runCIInstall } from './ci-install';
import { runInteractive } from './interactive';
import { runPlayground } from './playground';
import { runSkillMode } from './skill';
import { failNonInteractive } from './non-interactive';
import type { WizardCommand } from '../../wizard';

export const basicIntegrationCommand: WizardCommand = {
  name: ['$0'],
  description: 'Run the PostHog setup wizard',
  options: {
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
    playground: {
      default: false,
      describe: 'Launch the TUI primitives playground',
      type: 'boolean',
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
    'yara-report': {
      default: false,
      describe:
        'Print YARA scanner summary after the agent run\nenv: POSTHOG_WIZARD_YARA_REPORT',
      type: 'boolean',
      hidden: true,
    },
    skill: {
      describe:
        'Run a specific context-mill skill by ID\nenv: POSTHOG_WIZARD_SKILL',
      type: 'string',
    },
    name: {
      describe:
        'Name for account creation with --ci --signup\nenv: POSTHOG_WIZARD_NAME',
      type: 'string',
    },
  },
  handler: (argv) => {
    if (argv.ci) return runCIInstall(argv);
    if (isNonInteractiveEnvironment()) return failNonInteractive();
    if (argv.playground) return runPlayground();
    if (argv.skill) return runSkillMode(argv);
    runInteractive(argv);
  },
};
