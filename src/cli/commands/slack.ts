import type { Arguments } from 'yargs';
import { LoggingUI } from '@headless';
import { Program } from '@programs';
import { VERSION } from '@shared/config/version';
import { ErrorCodes } from '@shared/errors';
import { emitWizardError } from '@shared/errors';
import type { Command } from './command';
import { cliTuiHost } from '../tui-host';
import { getUI, setUI } from '../ui';

export const slackCommand: Command = {
  name: 'slack',
  description: 'Connect PostHog to your Slack',
  handler: runSlackConnect,
  // Mirrors the mcp command family shape: `wizard slack` and
  // `wizard slack add` run the same connect flow.
  children: [
    {
      name: 'add',
      description: 'Connect PostHog to your Slack',
      handler: runSlackConnect,
    },
  ],
};

function runSlackConnect(argv: Arguments): void {
  void (async () => {
    const debug = argv.debug as boolean | undefined;

    try {
      const { startTUI } = await (await import('@tui')).loadStartTui();
      const { buildSession } = await import('@tui');
      const tui = startTUI(VERSION, Program.SlackConnect, cliTuiHost());
      tui.store.session = buildSession({
        debug,
        baseUrl: argv.baseUrl as string | undefined,
      });
    } catch (err) {
      // TUI unavailable — connecting Slack has no headless fallback.
      setUI(new LoggingUI());
      getUI().log.error(
        `Connecting Slack requires an interactive terminal. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      emitWizardError({
        code: ErrorCodes.CliInteractiveRequired,
        message: 'Connecting Slack requires an interactive terminal.',
      });
      process.exit(1);
    }
  })();
}
