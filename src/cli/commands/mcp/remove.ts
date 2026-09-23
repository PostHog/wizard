import type { Arguments } from 'yargs';
import { LoggingUI } from '@headless';
import { headlessOption, isHeadless } from '@cli/headless-mode';
import { Program } from '@programs';
import { VERSION } from '@shared/version';
import type { Command } from '../command';
import { isTUIUnavailable } from './tui-availability';
import { cliTuiHost } from '@cli/tui-host';
import { setUI } from '@cli/ui';

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
  void (async () => {
    const debug = argv.debug as boolean | undefined;
    const localMcp = argv.local as boolean | undefined;

    // See the note in add.ts: a non-TTY run stalls on the confirm prompt
    // instead of falling back, so scripts need an explicit flag.
    if (isHeadless(argv)) {
      await runHeadlessRemove(localMcp);
      return;
    }

    try {
      const { startTUI } = await (await import('@tui')).loadStartTui();
      const { buildSession } = await import('@tui');
      const tui = startTUI(VERSION, Program.McpRemove, cliTuiHost());
      tui.store.session = buildSession({
        debug,
        localMcp,
        baseUrl: argv.baseUrl as string | undefined,
      });
    } catch (error) {
      // Same guard as `mcp add`: only a missing TTY falls back to LoggingUI,
      // so a genuine TUI bug surfaces instead of looking like a plain shell.
      if (!isTUIUnavailable(error)) throw error;
      await runHeadlessRemove(localMcp);
    }
  })();
}

/** No exit code on an empty result: nothing to remove is the requested end state. */
async function runHeadlessRemove(local?: boolean): Promise<void> {
  setUI(new LoggingUI());
  const { removeMCPServerFromClientsStep } = await import('./client-steps');
  await removeMCPServerFromClientsStep({ local });
}
