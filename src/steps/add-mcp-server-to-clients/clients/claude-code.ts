import { DefaultMCPClient } from '@steps/add-mcp-server-to-clients/MCPClient';
import {
  DefaultMCPClientConfig,
  buildMCPUrl,
} from '@steps/add-mcp-server-to-clients/defaults';
import {
  PluginCapable,
  PluginInstallResult,
} from '@steps/add-mcp-server-to-clients/plugin-client';
import { z } from 'zod';
import { execSync } from 'child_process';
import { analytics } from '@utils/analytics';
import { debug } from '@utils/debug';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export const ClaudeCodeMCPConfig = DefaultMCPClientConfig;

export type ClaudeCodeMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

/**
 * `claude plugin install <name>` only resolves against marketplaces the user
 * already has registered. The posthog plugin ships in Anthropic's official
 * marketplace, which Claude Code registers when it *starts interactively* — the
 * wizard shells straight into the non-interactive `plugin` subcommand, so on a
 * machine that never opened Claude Code the catalog isn't there and the install
 * dies with `Plugin "posthog" not found in any configured marketplace`. Register
 * the marketplace first, the same way the Codex client does.
 */
const PLUGIN_MARKETPLACE = 'claude-plugins-official';
const PLUGIN_MARKETPLACE_SOURCE = 'anthropics/claude-plugins-official';
const PLUGIN_REF = `posthog@${PLUGIN_MARKETPLACE}`;
const RETRY_COMMAND = `claude plugin install ${PLUGIN_REF}`;

/**
 * Failures that live entirely in the user's environment. We can't fix these
 * from the wizard and reporting them only creates unactionable issues, so we
 * hand the user a hint and move on.
 */
const EXPECTED_INSTALL_FAILURES: Array<{ match: RegExp; hint: string }> = [
  {
    match: /unknown command|unknown option|unknown argument|error: unknown/i,
    hint: `your Claude Code CLI is too old for plugins — update it, then run \`${RETRY_COMMAND}\``,
  },
  {
    match:
      /invalid schema|invalid json|not valid json|unexpected token|failed to parse|parse error|SyntaxError/i,
    hint: `Claude Code couldn't read its own config — fix the JSON it reports, then run \`${RETRY_COMMAND}\``,
  },
  {
    match: /ENOBUFS|ENOMEM|EAGAIN|EMFILE|maxBuffer/i,
    hint: `Claude Code ran out of room to report its output — run \`${RETRY_COMMAND}\` yourself`,
  },
  {
    match:
      /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|EHOSTUNREACH|timed out|timeout|could not resolve host|failed to clone|host key|publickey|proxy|certificate/i,
    hint: `Claude Code couldn't reach GitHub to download the plugin — check your network, then run \`${RETRY_COMMAND}\``,
  },
  {
    match:
      /EACCES|EPERM|permission denied|read-only file system|not permitted/i,
    hint: `Claude Code couldn't write to its plugin directory — fix the permissions, then run \`${RETRY_COMMAND}\``,
  },
  {
    match: /not allowed|blocked by|managed settings|disallowed|restricted/i,
    hint: 'your organization blocks Claude Code plugin marketplaces — the MCP server is set up either way',
  },
];

const FALLBACK_HINT = `the PostHog plugin didn't install — run \`${RETRY_COMMAND}\` to retry`;

/**
 * Replace home directories with `~` so one root cause groups as one issue
 * instead of one per user, and so usernames never reach error tracking.
 */
const scrubPaths = (text: string): string => {
  const home = os.homedir();
  const withoutHome = home ? text.split(home).join('~') : text;
  return withoutHome
    .replace(/\/(?:Users|home)\/[^/\s'"]+/g, '~')
    .replace(/[A-Za-z]:\\Users\\[^\\\s'"]+/gi, '~');
};

/** execSync throws an error whose stderr/stdout carry the useful detail. */
const describeExecError = (error: unknown): string => {
  const parts = [
    error instanceof Error ? error.message : String(error),
    ...(['stderr', 'stdout'] as const).map((key) => {
      const value = (error as Record<string, unknown> | null)?.[key];
      return value ? String(value) : '';
    }),
  ];
  return parts.filter(Boolean).join('\n');
};

type ClaudeRun = { ok: boolean; output: string };

export class ClaudeCodeMCPClient
  extends DefaultMCPClient
  implements PluginCapable
{
  name = 'Claude Code';
  private claudeBinaryPath: string | null = null;

  constructor() {
    super();
  }

  private findClaudeBinary(): string | null {
    if (this.claudeBinaryPath) {
      return this.claudeBinaryPath;
    }

    // Common installation paths for Claude Code CLI
    const possiblePaths = [
      path.join(os.homedir(), '.claude', 'local', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
    ];

    for (const claudePath of possiblePaths) {
      if (fs.existsSync(claudePath)) {
        debug(`  Found claude binary at: ${claudePath}`);
        this.claudeBinaryPath = claudePath;
        return claudePath;
      }
    }

    // Try PATH as fallback
    try {
      execSync('command -v claude', { stdio: 'pipe' });
      debug('  Found claude in PATH');
      this.claudeBinaryPath = 'claude';
      return 'claude';
    } catch {
      // Not in PATH
    }

    return null;
  }

  isClientSupported(): Promise<boolean> {
    try {
      debug('  Checking for Claude Code...');
      const claudeBinary = this.findClaudeBinary();

      if (!claudeBinary) {
        debug('  Claude Code not found. Installation paths checked:');
        debug(`    - ${path.join(os.homedir(), '.claude', 'local', 'claude')}`);
        debug(`    - /usr/local/bin/claude`);
        debug(`    - /opt/homebrew/bin/claude`);
        debug(`    - PATH`);
        return Promise.resolve(false);
      }

      const output = execSync(`${claudeBinary} --version`, { stdio: 'pipe' });
      const version = output.toString().trim();
      debug(`  Claude Code detected: ${version}`);
      return Promise.resolve(true);
    } catch (error) {
      debug(
        `  Claude Code check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return Promise.resolve(false);
    }
  }

  isServerInstalled(local?: boolean): Promise<boolean> {
    const binary = this.findClaudeBinary();
    if (!binary) return Promise.resolve(false);
    const serverName = local ? 'posthog-local' : 'posthog';
    try {
      const output = execSync(`${binary} mcp list`, { stdio: 'pipe' })
        .toString()
        .toLowerCase();
      return Promise.resolve(output.includes(serverName));
    } catch {
      return Promise.resolve(false);
    }
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    const binary = this.findClaudeBinary();
    if (!binary) return Promise.resolve({ success: false });

    const serverName = local ? 'posthog-local' : 'posthog';
    const url = buildMCPUrl(selectedFeatures, local);
    const args = [
      'mcp',
      'add',
      '--transport',
      'http',
      '--scope',
      'user',
      serverName,
      url,
    ];
    if (apiKey) {
      args.push('--header', `Authorization: Bearer ${apiKey}`);
    }

    try {
      execSync(`${binary} ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
        stdio: 'pipe',
      });
      return Promise.resolve({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists')) {
        return Promise.resolve({ success: true });
      }
      analytics.captureException(
        new Error(`Claude Code MCP add failed: ${msg}`),
      );
      return Promise.resolve({ success: false });
    }
  }

  removeServer(local?: boolean): Promise<{ success: boolean }> {
    const claudeBinary = this.findClaudeBinary();
    if (!claudeBinary) {
      return Promise.resolve({ success: false });
    }

    const serverName = local ? 'posthog-local' : 'posthog';
    const command = `${claudeBinary} mcp remove --scope user ${serverName}`;

    try {
      execSync(command);
    } catch (error) {
      analytics.captureException(
        new Error(
          `Failed to remove server from Claude Code: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
      return Promise.resolve({ success: false });
    }

    return Promise.resolve({ success: true });
  }

  supportsPlugin(): boolean {
    return this.findClaudeBinary() !== null;
  }

  isPluginInstalled(): Promise<boolean> {
    const binary = this.findClaudeBinary();
    if (!binary) return Promise.resolve(false);
    try {
      const output = execSync(`${binary} plugin list`, {
        stdio: 'pipe',
      }).toString();
      return Promise.resolve(output.toLowerCase().includes('posthog'));
    } catch {
      return Promise.resolve(false);
    }
  }

  private runClaude(binary: string, args: string[]): ClaudeRun {
    const command = `${binary} ${args.map((a) => JSON.stringify(a)).join(' ')}`;
    try {
      const output = execSync(command, { stdio: 'pipe' });
      return { ok: true, output: output?.toString() ?? '' };
    } catch (error) {
      return { ok: false, output: describeExecError(error) };
    }
  }

  /**
   * Register the marketplace the posthog plugin is published in, unless it's
   * already there. Best-effort: a failure here is only worth reporting if the
   * install that follows also fails.
   */
  private ensurePluginMarketplace(binary: string): ClaudeRun | null {
    const listed = this.runClaude(binary, ['plugin', 'marketplace', 'list']);
    if (listed.ok && listed.output.includes(PLUGIN_MARKETPLACE)) {
      debug(`  Marketplace ${PLUGIN_MARKETPLACE} already registered`);
      return null;
    }

    const added = this.runClaude(binary, [
      'plugin',
      'marketplace',
      'add',
      PLUGIN_MARKETPLACE_SOURCE,
    ]);
    if (added.ok || /already/i.test(added.output)) return null;

    debug(`  Marketplace add failed: ${added.output}`);
    return added;
  }

  installPlugin(): Promise<PluginInstallResult> {
    const binary = this.findClaudeBinary();
    if (!binary) return Promise.resolve({ success: false });

    const marketplaceFailure = this.ensurePluginMarketplace(binary);

    let result = this.runClaude(binary, ['plugin', 'install', PLUGIN_REF]);

    // A registered-but-stale catalog still reports the plugin as missing.
    if (!result.ok && /not found in/i.test(result.output)) {
      this.runClaude(binary, [
        'plugin',
        'marketplace',
        'update',
        PLUGIN_MARKETPLACE,
      ]);
      result = this.runClaude(binary, ['plugin', 'install', PLUGIN_REF]);
    }

    // Last resort: let Claude Code resolve the bare name against whichever
    // marketplaces the user does have, the way the wizard used to.
    if (!result.ok && /not found in/i.test(result.output)) {
      result = this.runClaude(binary, ['plugin', 'install', 'posthog']);
    }

    if (result.ok) return Promise.resolve({ success: true });

    if (/already installed|already exists/i.test(result.output)) {
      return Promise.resolve({ success: true, alreadyInstalled: true });
    }

    const stage = marketplaceFailure ? 'marketplace-add' : 'install';
    const details = scrubPaths(
      [marketplaceFailure?.output, result.output].filter(Boolean).join('\n'),
    );

    const expected = EXPECTED_INSTALL_FAILURES.find((f) =>
      f.match.test(details),
    );
    if (expected) {
      debug(`  Claude Code plugin install failed (expected): ${details}`);
      return Promise.resolve({ success: false, hint: expected.hint });
    }

    // Keep the message constant so one root cause is one issue — the resolved
    // binary path and the raw stderr go in properties, not the title.
    analytics.captureException(
      new Error(`Claude Code plugin install failed (${stage})`),
      { stage, binary: path.basename(binary), details },
    );
    return Promise.resolve({ success: false, hint: FALLBACK_HINT });
  }
}
