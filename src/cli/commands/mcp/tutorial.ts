import type { Arguments } from 'yargs';
import { consoleLog } from '@shared/console-log';
import { ErrorCodes, emitWizardError } from '@shared/errors';
import { Tool } from '@tools';
import { exitWith, underSignals } from '@cli/runners';
import type { Command } from '../command';

export const mcpTutorialCommand: Command = {
  name: 'tutorial',
  description: 'Try the PostHog MCP with your agent (no install needed)',
  options: {
    local: {
      default: false,
      describe:
        'Point the tutorial at the local MCP server (http://localhost:8787)',
      type: 'boolean',
    },
  },
  handler: runMcpTutorial,
};

function runMcpTutorial(argv: Arguments): void {
  exitWith(async () => {
    try {
      const { runTuiTool } = await import('@tui');
      return await underSignals((signal) =>
        runTuiTool(Tool.McpTutorial, {
          session: {
            debug: argv.debug as boolean | undefined,
            localMcp: argv.local as boolean | undefined,
            baseUrl: argv.baseUrl as string | undefined,
          },
          signal,
        }),
      );
    } catch (err) {
      // TUI unavailable — the tutorial has no headless fallback.
      consoleLog.log.error(
        `The MCP tutorial requires an interactive terminal. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      emitWizardError({
        code: ErrorCodes.CliInteractiveRequired,
        message: 'The MCP tutorial requires an interactive terminal.',
      });
      return 1;
    }
  });
}
