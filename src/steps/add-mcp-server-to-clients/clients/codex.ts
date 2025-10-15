import { DefaultMCPClient } from '../MCPClient';
import { getDefaultServerConfig } from '../defaults';
import { analytics } from '../../../utils/analytics';
import { execSync, spawnSync } from 'node:child_process';

export class CodexMCPClient extends DefaultMCPClient {
  name = 'Codex CLI';

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
    apiKey: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    const config = getDefaultServerConfig(
      apiKey,
      'sse',
      selectedFeatures,
      local,
    );
    const serverName = local ? 'posthog-local' : 'posthog';

    const args = ['mcp', 'add', serverName];

    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        args.push('--env', `${key}=${value}`);
      }
    }

    args.push('--', config.command, ...(config.args ?? []));

    const result = spawnSync('codex', args, { stdio: 'ignore' });

    if (result.error || result.status !== 0) {
      analytics.captureException(
        new Error(
          'Failed to add server to Codex CLI. Please ensure codex is installed.',
        ),
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
        new Error(
          'Failed to remove server from Codex CLI. Please ensure codex is installed.',
        ),
      );
      return Promise.resolve({ success: false });
    }

    return Promise.resolve({ success: true });
  }
}

export default CodexMCPClient;
