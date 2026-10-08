import type { Arguments } from 'yargs';
import { consoleLog } from '@shared/console-log';
import { ErrorCodes, emitWizardError } from '@shared/errors';
import { Tool } from '@tools';
import { exitWith, underSignals } from '@cli/runners';
import type { Command } from './command';

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
  exitWith(async () => {
    try {
      const { runTuiTool } = await import('@tui');
      return await underSignals((signal) =>
        runTuiTool(Tool.SlackConnect, {
          session: {
            debug: argv.debug as boolean | undefined,
            baseUrl: argv.baseUrl as string | undefined,
          },
          signal,
        }),
      );
    } catch (err) {
      // TUI unavailable — connecting Slack has no headless fallback.
      consoleLog.log.error(
        `Connecting Slack requires an interactive terminal. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      emitWizardError({
        code: ErrorCodes.CliInteractiveRequired,
        message: 'Connecting Slack requires an interactive terminal.',
      });
      return 1;
    }
  });
}
