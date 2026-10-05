import type { Arguments } from 'yargs';
import { consoleLog } from '@shared/console-log';
import { headlessOption, isHeadless } from '@shared/headless-mode';
import { readApiKeyFromEnv } from '@utils/env-api-key';
import { addMCPServerToClientsStep, Tool } from '@tools';
import { exitWith, underSignals } from '@cli/runners';
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
  const apiKey = (argv.apiKey as string | undefined) || readApiKeyFromEnv();
  const localMcp = argv.local as boolean | undefined;
  // Never forwards `ci`: headless implies session.ci elsewhere, and the step
  // reads that as "skip MCP entirely" — the opposite of what we're here to do.
  const headless = () =>
    addMCPServerToClientsStep(
      { local: localMcp, features, apiKey },
      { log: consoleLog.log },
    );

  // Ink renders into a pipe happily and only throws on raw-mode input, so a
  // non-TTY run reaches the confirm prompt and stalls there rather than
  // hitting the isTUIUnavailable fallback below. The headless flag is the
  // only reliable way to install from a script.
  if (isHeadless(argv)) {
    exitWith(headless);
    return;
  }

  exitWith(async () => {
    try {
      const { runTuiTool } = await import('@tui');
      return await underSignals((signal) =>
        runTuiTool(Tool.McpAdd, {
          session: {
            debug: argv.debug as boolean | undefined,
            localMcp,
            mcpFeatures: features,
            apiKey,
            baseUrl: argv.baseUrl as string | undefined,
          },
          signal,
        }),
      );
    } catch (error) {
      if (!isTUIUnavailable(error)) throw error;
      return headless();
    }
  });
}

function parseFeatures(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string') return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
