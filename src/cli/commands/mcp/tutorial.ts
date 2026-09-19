import type { Arguments } from 'yargs';
import { getUI, setUI } from '@store/ui';
import { LoggingUI } from '@tui/console/logging-ui';
import { Program } from '@store/programs/program-registry';
import { VERSION } from '@store/shared/version';
import { ErrorCodes } from '@store/shared/errors';
import { emitWizardError } from '@store/shared/errors';
import type { Command } from '../command.js';

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
      const { buildSession } = await import('@store/session/wizard-session');
      const tui = startTUI(VERSION, Program.McpTutorial);
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
