import {
  isNonInteractiveEnvironment,
  isRawModeSupported,
} from '@utils/environment';
import { setEntryCommand } from '@utils/links';
import { headlessOption, isHeadless } from '@lib/headless-mode';
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
    name: {
      describe:
        'Name for account creation with --ci --signup\nenv: POSTHOG_WIZARD_NAME',
      type: 'string',
    },
    // ── Internal modes ───────────────────────────────────────────────
    // Hidden from `--help`. See CONTRIBUTING.md for what each one does.
    playground: {
      default: false,
      describe: 'Launch the TUI primitives playground',
      type: 'boolean',
      hidden: true,
    },
    // The experimental headless flag — declared here (and on `audit`) rather
    // than globally. Routed by this command's handler via runHeadlessInstall.
    ...headlessOption,
  },
  check: (argv) => {
    // --playground is the standalone TUI demo; it can't combine with a
    // non-interactive run (either --ci or the experimental headless flag).
    if (argv.playground && (argv.ci || isHeadless(argv))) {
      throw new Error('--playground cannot be combined with a headless run.');
    }
    return true;
  },
  handler: (argv) => {
    // The bare run is the integrate flow.
    setEntryCommand('integrate');
    // Each mode file is loaded only when its branch is taken, so a plain
    // `npx @posthog/wizard` never pulls in the CI or playground paths.
    void (async () => {
      // ── The CI / headless division ───────────────────────────────────
      // --ci (dev/test only) and the experimental headless flag (the
      // published-build, non-interactive path; see @lib/headless-mode) both
      // request a non-interactive install, but route to dedicated entry points
      // — runHeadlessInstall vs runCIInstall (and below them runWizardHeadless
      // vs runWizardCI). Both share one pipeline today but are separate
      // functions end-to-end, so headless can diverge later without touching
      // the CI path or its callers.
      if (isHeadless(argv)) {
        const { runHeadlessInstall } = await import('./ci-install');
        return runHeadlessInstall(argv);
      }
      if (argv.ci) {
        const { runCIInstall } = await import('./ci-install');
        return runCIInstall(argv);
      }
      // `isNonInteractiveEnvironment` only inspects stdout/stderr, but the TUI
      // also needs a raw-mode-capable stdin. Some shells (sandboxed `npx`, a few
      // IDE terminals) give us a TTY stdout while stdin can't enter raw mode —
      // that combination slips past the stdout check and used to crash Ink with
      // an uncatchable "Raw mode is not supported" throw. Treat it as
      // non-interactive here so we surface the friendly message instead.
      if (isNonInteractiveEnvironment() || !isRawModeSupported()) {
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
