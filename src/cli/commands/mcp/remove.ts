import type { Arguments } from 'yargs';
import { consoleLog } from '@shared/console-log';
import { headlessOption, isHeadless } from '@shared/headless-mode';
import { removeMcpServer, Tool } from '@tools';
import { exitWith, underSignals } from '@cli/runners';
import type { Command } from '../command';
import { isTUIUnavailable } from './tui-availability';

export const mcpRemoveCommand: Command = {
  name: 'remove',
  description: 'Remove PostHog MCP server from supported clients',
  options: {
    local: {
      default: false,
      describe: 'Remove local development MCP server (http://localhost:8787)',
      type: 'boolean',
    },
    // Mirrors `mcp add` — see the note there on reusing the run pipeline's flag.
    ...headlessOption,
  },
  handler: runMcpRemove,
};

function runMcpRemove(argv: Arguments): void {
  const localMcp = argv.local as boolean | undefined;
  const headless = () =>
    removeMcpServer({ local: localMcp }, { log: consoleLog.log });

  // See the note in add.ts: a non-TTY run stalls on the confirm prompt
  // instead of falling back, so scripts need an explicit flag.
  if (isHeadless(argv)) {
    exitWith(headless);
    return;
  }

  exitWith(async () => {
    try {
      const { runTuiTool } = await import('@tui');
      return await underSignals((signal) =>
        runTuiTool(Tool.McpRemove, {
          session: {
            debug: argv.debug as boolean | undefined,
            localMcp,
            baseUrl: argv.baseUrl as string | undefined,
          },
          signal,
        }),
      );
    } catch (error) {
      // Same guard as `mcp add`: only a missing TTY falls back to the console,
      // so a genuine TUI bug surfaces instead of looking like a plain shell.
      if (!isTUIUnavailable(error)) throw error;
      return headless();
    }
  });
}
