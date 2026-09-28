import { z } from 'zod';
import { execSync, execFile, type ExecFileException } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { LoginCapable } from '@steps/add-mcp-server-to-clients/login-client';
import { DefaultMCPClient } from '@steps/add-mcp-server-to-clients/MCPClient';
import {
  DefaultMCPClientConfig,
  buildMCPUrl,
} from '@steps/add-mcp-server-to-clients/defaults';
import {
  PluginCapable,
  PluginInstallResult,
} from '@steps/add-mcp-server-to-clients/plugin-client';
import {
  redactSecrets,
  scrubHomePaths,
  expectedFailureHint,
  type ExpectedFailure,
  type InstallResult,
} from '@steps/add-mcp-server-to-clients/results';

import { analytics } from '@utils/analytics';

const PLUGIN_MARKETPLACE = 'posthog';
const PLUGIN_MARKETPLACE_SOURCE = 'PostHog/ai-plugin';
const PLUGIN_REF = `posthog@${PLUGIN_MARKETPLACE}`;

/**
 * The plugin's row in `codex plugin list`, whose STATUS column reads
 * `installed, enabled` or `not installed`. Registering the marketplace only
 * publishes the catalog, so the marketplace section in config.toml says nothing
 * about whether the plugin itself is there.
 */
const listedAsInstalled = (stdout: string): boolean => {
  const row = new RegExp(`^${PLUGIN_REF}\\s+(.*)$`, 'm').exec(stdout)?.[1];
  return !!row && /\binstalled\b/.test(row) && !/\bnot installed\b/.test(row);
};

/**
 * What `reportSpawnFailure` was doing, for hint scoping and for the report.
 * A union rather than loose strings: a hint scoped to a stage nobody passes is
 * silently dead, which is how `marketplace add` lost its hint the first time.
 */
type CodexStage =
  | 'MCP add'
  | 'MCP remove'
  | 'plugin install'
  | 'plugin uninstall'
  | 'marketplace add';

const PLUGIN_STAGES: CodexStage[] = [
  'plugin install',
  'plugin uninstall',
  'marketplace add',
];
const MCP_STAGES: CodexStage[] = ['MCP add', 'MCP remove'];
const ALL_STAGES: CodexStage[] = [...PLUGIN_STAGES, ...MCP_STAGES];

/**
 * Wording that proves the file codex choked on is the plugin's, not the user's.
 * Serde phrasing alone ("invalid type", "is no longer supported") says nothing
 * about whose file it came from, and blaming `~/.codex/config.toml` for our own
 * broken manifest sends the user to edit a file that is fine.
 */
const OUR_MANIFEST =
  /ai-plugin|plugin\.toml|plugin\.json|marketplace\.toml|posthog@posthog/i;

/**
 * Failures in the user's own environment. Reporting them files issues nobody
 * can action, so hand back a hint instead. Drawn from what the codex install
 * path actually produced in the field.
 *
 * Every entry is scoped: a hint that fires on the wrong stage tells the user to
 * run a command that has nothing to do with what just failed.
 */
const EXPECTED_FAILURES: ExpectedFailure[] = [
  {
    // `plugin`/`marketplace` subcommands a pre-plugin codex doesn't have.
    match:
      /unexpected argument|unknown (command|option|argument)|Missing option/i,
    stages: PLUGIN_STAGES,
    hint: 'your codex CLI is too old for plugins — update codex, then run `codex plugin marketplace add PostHog/ai-plugin`',
  },
  {
    // The same wording during `mcp add` is a flag we passed, not a plugin
    // subcommand, so the plugin advice above would send the user nowhere.
    match:
      /unexpected argument|unknown (command|option|argument)|Missing option/i,
    stages: MCP_STAGES,
    hint: 'your codex CLI is too old for this install — update codex, then run `npx @posthog/wizard mcp add` again',
  },
  {
    match: /ENOENT|not found in PATH|spawn .* ENOENT/i,
    stages: ALL_STAGES,
    hint: 'your codex install looks broken — reinstall codex, then run `codex plugin marketplace add PostHog/ai-plugin`',
  },
  {
    // Either codex says outright that it could not load its configuration, or
    // serde phrasing appears alongside `config.toml`. Bare serde wording cannot
    // tell the user's file from the plugin's, and `config.toml` on its own
    // silences any failure that merely mentions the path — both send someone to
    // edit a file that is fine, so the ambiguous case stays reportable.
    match:
      /failed to load (bootstrap )?configuration|OPENAI_API_KEY|Missing OpenAI API key|(?=[\s\S]*config\.toml)[\s\S]*(invalid type|unknown field|is no longer supported|must contain at least one)/i,
    stages: ALL_STAGES,
    unless: OUR_MANIFEST,
    hint: 'codex could not read its own config — fix what it reports in ~/.codex/config.toml, then retry',
  },
  {
    match:
      /EACCES|EPERM|permission denied|read-only file system|not permitted/i,
    stages: ALL_STAGES,
    // git says `Permission denied (publickey)` when an SSH clone of the
    // marketplace cannot authenticate to GitHub. Nothing on ~/.codex is wrong
    // there, so the hint below would send the user to chmod a directory that
    // is already fine while the real cause goes unreported.
    unless: /permission denied \((?:publickey|password|gssapi)/i,
    hint: 'codex could not write to its config — fix the permissions on ~/.codex, then retry',
  },
  {
    match: /ENOSPC|no space left/i,
    stages: ALL_STAGES,
    hint: 'the disk is full — free some space, then retry',
  },
  {
    // A clone that fails because the repo is missing is our publishing problem,
    // not the user's network, and telling them to check their connection buries
    // a renamed or deleted PostHog/ai-plugin where nobody will see it.
    match:
      /git clone .* failed|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|could not resolve host/i,
    stages: ALL_STAGES,
    unless:
      /repository not found|not found|404|does not exist|authentication failed/i,
    hint: 'codex could not reach GitHub to download the plugin — check your network, then retry',
  },
];

interface CodexRun {
  ok: boolean;
  /** Never blank on a failure: the cause, or the exit status when there is none. */
  output: string;
}

/**
 * A clone of the plugin marketplace is the slowest thing we run. Past this the
 * command is not slow, it is stuck, and the wizard should say so rather than
 * wait forever.
 */
const RUN_TIMEOUT_MS = 120_000;

/**
 * `execFile` kills the child once output passes this. The default is 1 MB,
 * which a verbose clone can reach, and the kill then looks like codex rejecting
 * the install rather than us cutting it off.
 */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * What `execFile` puts in `error.message` when the command itself never spoke:
 * the full binary path and arguments. That path contains the user's home
 * directory, so reporting it fingerprints one root cause per machine — the
 * failure this reporting was built to stop. Never send it onward.
 */
const COMMAND_FAILED_PREAMBLE = /^Command failed:.*$/m;

/**
 * The cause when neither stream carried one. `execFile` always sets a message,
 * so there is no "empty error" case to fall through — the message just isn't
 * usable as it stands.
 */
const describeExecFailure = (error: ExecFileException): string => {
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
    return 'codex produced more output than the wizard can hold, so it was stopped';
  if (error.killed)
    return `codex did not finish within ${
      RUN_TIMEOUT_MS / 1000
    }s, so it was stopped`;
  if (error.signal) return `codex was killed by ${error.signal}`;

  const said = error.message.replace(COMMAND_FAILED_PREAMBLE, '').trim();
  if (said) return said;
  if (typeof error.code === 'number')
    return `codex exited with code ${error.code}`;
  if (error.code) return `codex failed with ${error.code}`;
  return 'codex failed without reporting a reason';
};

/**
 * One codex invocation. Async on purpose: `plugin marketplace add` and
 * `plugin add` clone git repositories and take seconds, and a synchronous child
 * process blocks the event loop, which freezes the TUI spinner on its first
 * frame. Never throws; the caller decides what a failure means.
 *
 * A failure's cause is split across the error and the two streams, and none of
 * them carries it when the process merely exits non-zero — reading one alone
 * reported a blank reason and filed an exception carrying nothing.
 */
const runCodex = (
  binary: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<CodexRun> =>
  new Promise((resolve) => {
    const child = execFile(
      binary,
      args,
      { env, timeout: RUN_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        if (!error) return resolve({ ok: true, output: stdout ?? '' });
        // stderr first: it carries what codex actually said, and the TUI shows
        // the first line. `error.message` leads with our own invocation, so
        // preferring it would show the user the command instead of the cause.
        const said = [stderr, stdout]
          .map((p) => (p ? String(p).trim() : ''))
          .filter(Boolean)
          .join('\n');
        // A kill is ours, not codex's, so it outranks whatever the streams got
        // out before we cut them off.
        const stopped =
          error.killed ||
          !!error.signal ||
          error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        resolve({
          ok: false,
          output: redactSecrets(
            stopped || !said ? describeExecFailure(error) : said,
          ),
        });
      },
    );
    // codex asks for nothing on stdin here. Leaving the pipe open means a
    // command that does ask waits on input that never comes, and the promise
    // never settles. `spawnSync` closed it for us.
    child.stdin?.end();
  });

/**
 * Turn a failed spawn into a result: an expected local failure becomes a hint,
 * anything else is reported under a constant message so one root cause stays
 * one issue, with the varying detail in properties.
 */
const reportSpawnFailure = (
  stage: CodexStage,
  details: string,
): InstallResult => {
  const hint = expectedFailureHint(details, EXPECTED_FAILURES, stage);
  if (hint) {
    // Hinting takes a failure out of error tracking, so without this the only
    // evidence a pattern has started over-matching is that our exception count
    // fell, which reads as the fix working. An event keeps the count.
    analytics.wizardCapture('mcp expected failure hinted', {
      client: 'Codex',
      stage,
      hint,
      details: scrubHomePaths(details),
    });
    return { success: false, reason: hint };
  }
  analytics.captureException(new Error(`Codex ${stage} failed`), {
    stage,
    details: scrubHomePaths(details),
  });
  return { success: false, reason: details };
};

/** Wording codex uses when the thing we're adding is already registered. */
const ALREADY_INSTALLED_PATTERN =
  /already (installed|exists|added|registered)/i;
/** Wording that means the opposite: a cache entry exists but the plugin doesn't. */
const STALE_MARKETPLACE_CACHE = /already added from a different source/i;

/**
 * Codex allows servers 10s to finish the MCP initialize handshake, and a remote
 * OAuth handshake can exceed that on a cold start — the "servers were not
 * initialized" warning.
 */
const STARTUP_TIMEOUT_SEC = 30;

/**
 * The server's table header. TOML accepts a bare or quoted key for the same
 * table, and matching only the bare form means we append a second definition of
 * a table that already exists — a duplicate-key error that takes the user's
 * whole config down, not just PostHog's entry.
 */
const sectionHeader = (serverName: string): RegExp =>
  new RegExp(
    `^\\[mcp_servers\\.(?:${serverName}|"${serverName}")\\][ \\t]*$`,
    'm',
  );

/**
 * Set `key = value` inside a section body, inserting it when absent. Scans the
 * whole body rather than the line after the header: TOML does not care about
 * key order, and assuming it does means silently matching nothing.
 */
const setKey = (body: string, key: string, value: string): string => {
  const existing = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'm');
  return existing.test(body)
    ? body.replace(existing, `${key} = ${value}`)
    : `\n${key} = ${value}${body}`;
};

export const CodexMCPConfig = DefaultMCPClientConfig;

export type CodexMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class CodexMCPClient
  extends DefaultMCPClient
  implements PluginCapable, LoginCapable
{
  name = 'Codex';
  private codexBinaryPath: string | null = null;

  constructor() {
    super();
  }

  private findCodexBinary(): string | null {
    if (this.codexBinaryPath) return this.codexBinaryPath;
    try {
      const resolved = execSync('command -v codex', { stdio: 'pipe' })
        .toString()
        .trim();
      if (resolved) {
        this.codexBinaryPath = resolved;
        return resolved;
      }
    } catch {
      // not in PATH
    }
    return null;
  }

  private configPath(): string {
    return path.join(os.homedir(), '.codex', 'config.toml');
  }

  isClientSupported(): Promise<boolean> {
    return Promise.resolve(this.findCodexBinary() !== null);
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  isServerInstalled(local?: boolean): Promise<boolean> {
    const serverName = local ? 'posthog-local' : 'posthog';
    // The `[mcp_servers.<name>]` section in config.toml — both the CLI and the
    // desktop app read (and `codex mcp add` writes) this file, and a substring
    // scan of `mcp list` matches unrelated posthog-ish servers.
    try {
      const contents = fs.readFileSync(this.configPath(), 'utf-8');
      return Promise.resolve(sectionHeader(serverName).test(contents));
    } catch {
      return Promise.resolve(false);
    }
  }

  async addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<InstallResult> {
    const serverName = local ? 'posthog-local' : 'posthog';
    const url = buildMCPUrl(selectedFeatures, local);

    // Api-key installs go through the CLI for its bearer-token env wiring.
    if (apiKey) {
      const binary = this.findCodexBinary();
      if (!binary)
        return {
          success: false,
          reason: 'An API-key install into Codex needs the codex CLI.',
        };
      const args = [
        'mcp',
        'add',
        serverName,
        '--url',
        url,
        '--bearer-token-env-var',
        'POSTHOG_AUTH_HEADER',
      ];
      const env = { ...process.env, POSTHOG_AUTH_HEADER: `Bearer ${apiKey}` };
      const result = await runCodex(binary, args, env);
      if (!result.ok) {
        if (ALREADY_INSTALLED_PATTERN.test(result.output)) {
          return { success: true, alreadyInstalled: true };
        }
        return reportSpawnFailure('MCP add', result.output);
      }
      return { success: true };
    }

    // OAuth installs write config.toml directly: running `codex mcp add` here
    // would hang the wizard on its built-in OAuth browser wait. Codex nags
    // about the unauthenticated server until the surfaced `codex mcp login`
    // runs — the same interim state as Claude Code's "needs authentication".
    return this.writeServerSection(serverName, url);
  }

  /**
   * Create or update the `[mcp_servers.<name>]` section in config.toml, editing
   * in place so the user's other servers, key order, and comments survive.
   */
  private writeServerSection(serverName: string, url: string): InstallResult {
    const configPath = this.configPath();
    try {
      // A machine that has codex installed but has never run it has no
      // ~/.codex at all — `codex mcp add` used to create it for us.
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const contents = fs.existsSync(configPath)
        ? fs.readFileSync(configPath, 'utf-8')
        : '';

      const header = sectionHeader(serverName).exec(contents);
      if (!header) {
        const gap = contents === '' || contents.endsWith('\n\n') ? '' : '\n';
        const pad = contents === '' || contents.endsWith('\n') ? '' : '\n';
        this.write(
          configPath,
          `${contents}${pad}${gap}[mcp_servers.${serverName}]\n` +
            `url = "${url}"\nstartup_timeout_sec = ${STARTUP_TIMEOUT_SEC}\n`,
        );
        return { success: true };
      }

      // Everything up to the next table header belongs to this server.
      const start = header.index + header[0].length;
      const rest = contents.slice(start);
      const next = /^\[/m.exec(rest);
      const end = next ? start + next.index : contents.length;

      const body = contents.slice(start, end);
      const updated = setKey(
        setKey(body, 'url', `"${url}"`),
        'startup_timeout_sec',
        String(STARTUP_TIMEOUT_SEC),
      );
      if (updated === body) return { success: true, alreadyInstalled: true };

      this.write(
        configPath,
        contents.slice(0, start) + updated + contents.slice(end),
      );
      return { success: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Constant message, varying detail in properties: the reason carries the
      // config path, so interpolating it filed one issue per user.
      analytics.captureException(new Error('Codex config.toml write failed'), {
        details: scrubHomePaths(reason),
      });
      return { success: false, reason };
    }
  }

  /** Write via a sibling temp file: a crash mid-write must not truncate the config. */
  private write(configPath: string, contents: string): void {
    const tmp = `${configPath}.wizard-tmp`;
    fs.writeFileSync(tmp, contents);
    fs.renameSync(tmp, configPath);
  }

  /** Codex's own login runs its OAuth and owns the token; the wizard only surfaces the command. */
  loginCommand(local?: boolean): string | null {
    if (!this.findCodexBinary()) return null;
    return `codex mcp login ${local ? 'posthog-local' : 'posthog'}`;
  }

  async removeServer(local?: boolean): Promise<InstallResult> {
    const binary = this.findCodexBinary();
    if (!binary)
      return {
        success: false,
        reason: 'The codex CLI is no longer on your PATH.',
      };

    // `local` was ignored here, so `mcp remove --local` reported success while
    // leaving the posthog-local server in place.
    const serverName = local ? 'posthog-local' : 'posthog';
    const result = await runCodex(binary, ['mcp', 'remove', serverName]);

    if (!result.ok) {
      return reportSpawnFailure('MCP remove', result.output);
    }

    return { success: true };
  }

  /** The codex marketplace plugin ships skills only — the MCP server needs its own entry. */
  pluginBundlesMcpServer(): boolean {
    return false;
  }

  supportsPlugin(): boolean {
    return this.findCodexBinary() !== null;
  }

  /** The plugin itself, as the CLI reports it. The install decision's question. */
  private async isPluginPresent(): Promise<boolean> {
    const binary = this.findCodexBinary();
    if (!binary) return false;
    const result = await runCodex(binary, [
      'plugin',
      'list',
      '-m',
      PLUGIN_MARKETPLACE,
    ]);
    return result.ok && listedAsInstalled(result.output);
  }

  /**
   * Anything of ours left on the machine, which is what `index.ts` asks before
   * offering removal. A registered marketplace with no plugin is a state the
   * wizard created — and the state this branch exists to correct — so removal
   * has to see it, or `removePlugin` never runs and the catalog stays forever.
   */
  async isPluginInstalled(): Promise<boolean> {
    return (await this.isPluginPresent()) || this.isMarketplaceRegistered();
  }

  /** The catalog, which the plugin is installed *from* — not the plugin. */
  private isMarketplaceRegistered(): boolean {
    try {
      const contents = fs.readFileSync(this.configPath(), 'utf-8');
      return contents
        .toLowerCase()
        .includes(`[marketplaces.${PLUGIN_MARKETPLACE}]`);
    } catch {
      return false;
    }
  }

  async removePlugin(): Promise<PluginInstallResult> {
    const binary = this.findCodexBinary();
    if (!binary)
      return {
        success: false,
        reason: 'The codex CLI is no longer on your PATH.',
      };

    // Both halves are removed, and either alone is enough to act on: a user
    // left with a registered marketplace and no plugin still needs it cleared.
    const steps: string[][] = [];
    if (await this.isPluginPresent())
      steps.push(['plugin', 'remove', PLUGIN_REF]);
    if (this.isMarketplaceRegistered())
      steps.push(['plugin', 'marketplace', 'remove', PLUGIN_MARKETPLACE]);

    if (steps.length === 0) return { success: true, alreadyInstalled: true };

    for (const args of steps) {
      const result = await runCodex(binary, args);
      if (!result.ok) {
        return reportSpawnFailure('plugin uninstall', result.output);
      }
    }
    return { success: true };
  }

  async installPlugin(): Promise<PluginInstallResult> {
    const binary = this.findCodexBinary();
    if (!binary)
      return {
        success: false,
        reason: 'The codex CLI is no longer on your PATH.',
      };

    // The plugin, not the catalog: a registered marketplace with no plugin is
    // exactly the broken state this installs over, so asking the wider question
    // here would skip the install and leave it broken.
    if (await this.isPluginPresent()) {
      return { success: true, alreadyInstalled: true };
    }

    // `codex plugin marketplace add` exits non-zero once the marketplace is
    // registered, so ask config.toml first. Without this the second run of
    // `mcp add` looked like a failure and reported nothing at all.
    const marketplace = this.isMarketplaceRegistered()
      ? null
      : await this.registerMarketplace(binary);
    if (marketplace && !marketplace.success) return marketplace;

    // Registering the catalog does not install from it. Skipping this left the
    // user with a marketplace, no skills, and a wizard reporting success.
    const result = await runCodex(binary, ['plugin', 'add', PLUGIN_REF]);

    if (!result.ok) {
      // The listing above can report "not installed" when it merely failed to
      // run, and every other spawn here reads codex's own wording rather than
      // turning a no-op into a reported failure.
      if (ALREADY_INSTALLED_PATTERN.test(result.output)) {
        return { success: true, alreadyInstalled: true };
      }
      return reportSpawnFailure('plugin install', result.output);
    }

    return { success: true };
  }

  /**
   * Add the catalog the plugin is published in. A stale cache directory with no
   * config.toml entry reports the marketplace as added from a different source;
   * clear it and retry once.
   */
  private async registerMarketplace(
    binary: string,
  ): Promise<PluginInstallResult> {
    const run = () =>
      runCodex(binary, [
        'plugin',
        'marketplace',
        'add',
        PLUGIN_MARKETPLACE_SOURCE,
      ]);

    let result = await run();

    if (!result.ok && STALE_MARKETPLACE_CACHE.test(result.output)) {
      const staleDir = path.join(
        os.homedir(),
        '.codex',
        '.tmp',
        'marketplaces',
        PLUGIN_MARKETPLACE,
      );
      try {
        fs.rmSync(staleDir, { recursive: true, force: true });
      } catch {
        // ignore — retry anyway
      }
      result = await run();
    }

    if (!result.ok) {
      const details = result.output;
      // Registered by something other than us — the plugin add below can still
      // resolve against it. The stale-cache wording is excluded: that one means
      // the marketplace is NOT usable, and only reaches here if the retry failed.
      if (
        ALREADY_INSTALLED_PATTERN.test(details) &&
        !STALE_MARKETPLACE_CACHE.test(details)
      ) {
        return { success: true };
      }
      return reportSpawnFailure('marketplace add', details);
    }
    return { success: true };
  }
}

export default CodexMCPClient;
