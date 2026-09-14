import type { Arguments } from 'yargs';
import { setUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { headlessOption, isHeadless } from '@lib/headless-mode';
import { Program } from '@lib/programs/program-registry';
import { VERSION } from '@lib/version';
import type { Command } from '../command';
import { isTUIUnavailable } from './tui-availability';

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
    // Reuses the run pipeline's headless flag rather than minting a public one:
    // this stays reversible, and today the only caller is our own CI.
    ...headlessOption,
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
    const args = { local: localMcp, features, apiKey };

    // Ink renders into a pipe happily and only throws on raw-mode input, so a
    // non-TTY run reaches the confirm prompt and stalls there rather than
    // hitting the isTUIUnavailable fallback below. The headless flag is the
    // only reliable way to install from a script.
    if (isHeadless(argv)) {
      await runHeadlessAdd(args);
      return;
    }

    try {
      const { startTUI } = await import('@ui/tui/start-tui');
      const { buildSession } = await import('@lib/wizard-session');
      const tui = startTUI(VERSION, Program.McpAdd);
      tui.store.session = buildSession({
        debug,
        localMcp,
        mcpFeatures: features,
        apiKey,
        baseUrl: argv.baseUrl as string | undefined,
      });
    } catch (error) {
      if (!isTUIUnavailable(error)) throw error;
      await runHeadlessAdd(args);
    }
  })();
}

async function runHeadlessAdd(args: {
  local?: boolean;
  features?: string[];
  apiKey?: string;
}): Promise<void> {
  setUI(new LoggingUI());
  const { addMCPServerToClientsStep } = await import(
    '@steps/add-mcp-server-to-clients/index'
  );
  // Never forwards `ci`: headless implies session.ci elsewhere, and the step
  // reads that as "skip MCP entirely" — the opposite of what we're here to do.
  const { installed, failed } = await addMCPServerToClientsStep(args);
  // A scripted caller has no screen to read, so this has to be an exit code.
  // Any failure counts, not just a total wipeout: the step installs to every
  // detected client, so one succeeding would otherwise mask the rest.
  if (failed.length > 0 || installed.length === 0) process.exitCode = 1;
}

function parseFeatures(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string') return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
