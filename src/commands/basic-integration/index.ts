import { wizardEnvBool, wizardEnvDefault } from '@env';
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
    'install-dir': {
      ...wizardEnvDefault('INSTALL_DIR'),
      describe: 'Directory to install PostHog in\nenv: WIZARD_INSTALL_DIR',
      type: 'string',
    },
    playground: {
      default: false,
      describe: 'Launch the TUI primitives playground',
      type: 'boolean',
    },
    benchmark: {
      default: wizardEnvBool('BENCHMARK', false),
      describe:
        'Run in benchmark mode with per-phase token tracking\nenv: WIZARD_BENCHMARK',
      type: 'boolean',
    },
    'yara-report': {
      default: wizardEnvBool('YARA_REPORT', false),
      describe:
        'Print YARA scanner summary after the agent run\nenv: WIZARD_YARA_REPORT',
      type: 'boolean',
      hidden: true,
    },
    skill: {
      ...wizardEnvDefault('SKILL'),
      describe: 'Run a specific context-mill skill by ID\nenv: WIZARD_SKILL',
      type: 'string',
    },
    name: {
      ...wizardEnvDefault('NAME'),
      describe:
        'Name for account creation with --ci --signup\nenv: WIZARD_NAME',
      type: 'string',
    },
  },
  check: (argv) => {
    // --playground is the standalone TUI demo; it can't combine with the other
    // run modes. (--ci + --skill IS valid — run a skill headlessly.)
    if (argv.playground && (argv.ci || argv.skill)) {
      throw new Error('--playground cannot be combined with --ci or --skill.');
    }
    // --skill with no ID would otherwise fall through to the interactive flow.
    if (typeof argv.skill === 'string' && argv.skill.trim() === '') {
      throw new Error('--skill needs a skill ID, e.g. --skill="foo"');
    }
    return true;
  },
  handler: (argv) => {
    // Each mode file is loaded only when its branch is taken, so a plain
    // `npx @posthog/wizard` never pulls in the CI, playground, or skill paths.
    void (async () => {
      // --ci --skill runs the skill headlessly (skill takes precedence over the
      // default CI integration); --ci alone runs the integration.
      if (argv.ci && argv.skill) {
        const { runSkillMode } = await import('./skill');
        return runSkillMode(argv);
      }
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
