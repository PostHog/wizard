import type { Arguments } from 'yargs';
import { setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { Program } from '@lib/programs/program-registry';
import { VERSION } from '@lib/version';
import type { Command } from '../command';

export const mcpAddCommand: Command = {
  name: 'add',
  description: 'Install PostHog MCP server to supported clients',
  options: {
    local: {
      default: false,
      describe: 'Add local development MCP server (http://localhost:8787)',
      type: 'boolean',
    },
    features: {
      describe: 'Comma-separated list of features to enable (default: all)',
      type: 'string',
    },
    'api-key': {
      describe: 'PostHog personal API key (phx_xxx) for MCP authentication',
      type: 'string',
    },
  },
  handler: runMcpAdd,
};

function runMcpAdd(argv: Arguments): void {
  const features = parseFeatures(argv.features);
  void (async () => {
    const { readApiKeyFromEnv } = await import('@utils/env-api-key');
    const apiKey = (argv.apiKey as string | undefined) || readApiKeyFromEnv();
    const debug = argv.debug as boolean | undefined;
    const localMcp = argv.local as boolean | undefined;

    try {
      const { startTUI } = await import('@ui/tui/start-tui');
      const { buildSession } = await import('@lib/wizard-session');
      const tui = startTUI(VERSION, Program.McpAdd);
      tui.store.session = buildSession({
        debug,
        localMcp,
        mcpFeatures: features,
        apiKey,
      });
    } catch (error) {
      if (!isTUIUnavailable(error)) throw error;
      setUI(new LoggingUI());
      const { addMCPServerToClientsStep } = await import(
        '@steps/add-mcp-server-to-clients/index'
      );
      await addMCPServerToClientsStep({ local: localMcp, features, apiKey });
    }
  })();
}

/**
 * Ink throws "Raw mode is not supported" when stdin has no TTY (piped input,
 * CI, some IDE terminals). That is the only TUI failure we degrade to
 * LoggingUI for — any other error from the TUI path is a real bug and must
 * surface rather than be silently swallowed.
 */
function isTUIUnavailable(error: unknown): boolean {
  return (
    error instanceof Error && /raw mode is not supported/i.test(error.message)
  );
}

function parseFeatures(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string') return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
