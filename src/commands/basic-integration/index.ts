import { isNonInteractiveEnvironment } from '@utils/environment';
import { provisionCommand } from '../provision';
import type { Command } from '../command';

export const basicIntegrationCommand: Command = {
  name: ['$0'],
  description: 'Run the PostHog setup wizard',
  // provision is a one-shot HTTP call tied to the base flow, not a wizard
  // program — it rides under the base command rather than as a peer.
  children: [provisionCommand],
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
  // ci, playground, and skill select different run modes — at most one.
  check: (argv) => {
    const modes = (['ci', 'playground', 'skill'] as const).filter(
      (key) => argv[key],
    );
    if (modes.length > 1) {
      throw new Error(
        `--${modes.join(', --')} are mutually exclusive; pass only one.`,
      );
    }
    return true;
  },
  handler: (argv) => {
    // Each mode file is loaded only when its branch is taken, so a plain
    // `npx @posthog/wizard` never pulls in the CI, playground, or skill paths.
    void (async () => {
      if (argv.ci) {
        const { runCIInstall } = await import('./ci-install');
        return runCIInstall(argv);
      }
      if (isNonInteractiveEnvironment()) {
        const { failNonInteractive } = await import('./non-interactive');
        return failNonInteractive();
      }
      if (argv.playground) {
        const { runPlayground } = await import('./playground');
        return runPlayground();
      }
      if (argv.skill) {
        const { runSkillMode } = await import('./skill');
        return runSkillMode(argv);
      }
      const { runInteractive } = await import('./interactive');
      runInteractive(argv);
    })();
  },
};
