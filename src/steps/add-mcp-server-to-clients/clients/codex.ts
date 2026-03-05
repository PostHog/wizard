import { z } from 'zod';
import { execSync, spawnSync } from 'node:child_process';

import { DefaultMCPClient } from '../MCPClient';
import { buildMCPUrl, DefaultMCPClientConfig } from '../defaults';

import { analytics } from '../../../utils/analytics';

export const CodexMCPConfig = DefaultMCPClientConfig;

export type CodexMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class CodexMCPClient extends DefaultMCPClient {
  name = 'Codex';

  constructor() {
    super();
  }

  isClientSupported(): Promise<boolean> {
    try {
      execSync('codex --version', { stdio: 'ignore' });
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  isServerInstalled(local?: boolean): Promise<boolean> {
    const serverName = local ? 'posthog-local' : 'posthog';

    try {
      const result = spawnSync('codex', ['mcp', 'list', '--json'], {
        encoding: 'utf-8',
      });

      if (result.error || result.status !== 0) {
        return Promise.resolve(false);
      }

      const stdout = result.stdout?.trim();
      if (!stdout) {
        return Promise.resolve(false);
      }

      const servers = JSON.parse(stdout) as Array<{ name: string }>;
      return Promise.resolve(
        servers.some((server) => server.name === serverName),
      );
    } catch {
      return Promise.resolve(false);
    }
  }

  addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    const serverName = local ? 'posthog-local' : 'posthog';
    const url = buildMCPUrl('streamable-http', selectedFeatures, local);

    const args = ['mcp', 'add', serverName, '--url', url];

    const env = { ...process.env };
    if (apiKey) {
      env.POSTHOG_API_KEY = apiKey;
      args.push('--bearer-token-env-var', 'POSTHOG_API_KEY');
    }

    const result = spawnSync('codex', args, { stdio: 'ignore', env });

    if (result.error || result.status !== 0) {
      analytics.captureException(
        new Error('Failed to add server to Codex CLI.'),
      );
      return Promise.resolve({ success: false });
    }

    return Promise.resolve({ success: true });
  }

  removeServer(local?: boolean): Promise<{ success: boolean }> {
    const serverName = local ? 'posthog-local' : 'posthog';
    const result = spawnSync('codex', ['mcp', 'remove', serverName], {
      stdio: 'ignore',
    });

    if (result.error || result.status !== 0) {
      analytics.captureException(
        new Error('Failed to remove server from Codex CLI.'),
      );
      return Promise.resolve({ success: false });
    }

    return Promise.resolve({ success: true });
  }
}

export default CodexMCPClient;
