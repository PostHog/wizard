import type { Arguments } from 'yargs';
import { LoggingUI } from '@headless/renderers/logging-ui';
import { Program } from '@programs';
import { VERSION } from '@shared/version';
import { ErrorCodes } from '@shared/errors';
import { emitWizardError } from '@shared/errors';
import type { Command } from '../command';
import { cliTuiHost } from '@cli/tui-host';
import { getUI, setUI } from '@cli/ui';

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
  void (async () => {
    const debug = argv.debug as boolean | undefined;
    const localMcp = argv.local as boolean | undefined;

    try {
      const { startTUI } = await import('@tui/start-tui');
      const { buildSession } = await import('@tui/session');
      const tui = startTUI(VERSION, Program.McpTutorial, cliTuiHost());
      tui.store.session = buildSession({
        debug,
        localMcp,
        baseUrl: argv.baseUrl as string | undefined,
      });
    } catch (err) {
      // TUI unavailable — the tutorial has no headless fallback.
      setUI(new LoggingUI());
      getUI().log.error(
        `The MCP tutorial requires an interactive terminal. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      emitWizardError({
        code: ErrorCodes.CliInteractiveRequired,
        message: 'The MCP tutorial requires an interactive terminal.',
      });
      process.exit(1);
    }
  })();
}
