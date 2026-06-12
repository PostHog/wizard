import { isNonInteractiveEnvironment } from '@utils/environment';
import { setEntryCommand } from '@utils/links';
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
      describe:
        'Directory to install PostHog in\nenv: POSTHOG_WIZARD_INSTALL_DIR',
      type: 'string',
    },
    playground: {
      default: false,
      describe: 'Launch the TUI primitives playground',
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
    name: {
      describe:
        'Name for account creation with --ci --signup\nenv: POSTHOG_WIZARD_NAME',
      type: 'string',
    },
  },
  check: (argv) => {
    // --playground is the standalone TUI demo; it can't combine with --ci.
    if (argv.playground && argv.ci) {
      throw new Error('--playground cannot be combined with --ci.');
    }
    return true;
  },
  handler: (argv) => {
    // The bare run is the integrate flow.
    setEntryCommand('integrate');
    // Each mode file is loaded only when its branch is taken, so a plain
    // `npx @posthog/wizard` never pulls in the CI or playground paths.
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
      const { runInteractive } = await import('./interactive');
      runInteractive(argv);
    })();
  },
};
