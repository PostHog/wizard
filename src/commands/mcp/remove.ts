import type { Arguments } from 'yargs';
import { setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { Program } from '@lib/programs/program-registry';
import { VERSION } from '@lib/version';
import type { Command } from '../command';
import { analytics } from '@utils/analytics';

export const mcpRemoveCommand: Command = {
  name: 'remove',
  description: 'Remove PostHog MCP server from supported clients',
  options: {
    local: {
      default: false,
      describe: 'Remove local development MCP server (http://localhost:8787)',
      type: 'boolean',
    },
  },
  handler: runMcpRemove,
};

function runMcpRemove(argv: Arguments): void {
  void (async () => {
    const debug = argv.debug as boolean | undefined;
    const localMcp = argv.local as boolean | undefined;

    try {
      const { startTUI } = await import('@ui/tui/start-tui');
      const { buildSession } = await import('@lib/wizard-session');
      const tui = startTUI(VERSION, Program.McpRemove);
      tui.store.session = buildSession({
        debug,
        localMcp,
        baseUrl: argv.baseUrl as string | undefined,
      });
    } catch (err) {
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'run_mcp_remove' },
      );
      setUI(new LoggingUI());
      const { removeMCPServerFromClientsStep } = await import(
        '@steps/add-mcp-server-to-clients/index'
      );
      await removeMCPServerFromClientsStep({ local: localMcp });
    }
  })();
}
