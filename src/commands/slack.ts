import type { Arguments } from 'yargs';
import { getUI, setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { Program } from '@lib/programs/program-registry';
import { VERSION } from '@lib/version';
import type { Command } from './command';

export const slackCommand: Command = {
  name: 'slack',
  description: 'Connect PostHog to your Slack',
  handler: runSlackConnect,
};

function runSlackConnect(argv: Arguments): void {
  void (async () => {
    const debug = argv.debug as boolean | undefined;

    try {
      const { startTUI } = await import('@ui/tui/start-tui');
      const { buildSession } = await import('@lib/wizard-session');
      const tui = startTUI(VERSION, Program.SlackConnect);
      tui.store.session = buildSession({ debug });
    } catch (err) {
      // TUI unavailable — connecting Slack has no headless fallback.
      setUI(new LoggingUI());
      getUI().log.error(
        `Connecting Slack requires an interactive terminal. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      process.exit(1);
    }
  })();
}
