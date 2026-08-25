/**
 * Runs a headless `wizard mcp add` against a real editor CLI in a throwaway HOME
 * and asserts the config that comes out. Drives the built binary rather than
 * importing client classes, so arg parsing and command wiring are covered too.
 *
 * Needs no credentials: the OAuth path writes a tokenless entry and defers auth
 * to the editor's own login command.
 *
 * Usage: tsx scripts/mcp-install-smoke-test.ts --provider=claude-code|codex
 */

import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HEADLESS_FLAG } from '../src/lib/headless-mode';

const PROVIDERS = ['claude-code', 'codex'] as const;
type Provider = (typeof PROVIDERS)[number];

const MCP_URL = 'https://mcp.posthog.com/mcp';
const WIZARD = path.resolve(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  'dist',
  'bin.js',
);

interface ProviderSpec {
  /** Editor CLI binary, looked up on PATH. */
  binary: string;
  /** The login subcommand the wizard tells the user to run, minus the server name. */
  loginProbe: string[];
  /** Config file relative to HOME, set only when the file is the contract. */
  configPath?: string;
  /** Exit code of a "is posthog installed" probe against the editor itself. */
  isInstalled: () => boolean;
}

const SPECS: Record<Provider, ProviderSpec> = {
  'claude-code': {
    binary: 'claude',
    loginProbe: ['mcp', 'login', '--help'],
    isInstalled: () => run('claude', ['mcp', 'get', 'posthog']).status === 0,
  },
  codex: {
    binary: 'codex',
    loginProbe: ['mcp', 'login', '--help'],
    configPath: '.codex/config.toml',
    isInstalled: () =>
      (
        readIfPresent(path.join(process.env.HOME!, '.codex', 'config.toml')) ??
        ''
      ).includes('[mcp_servers.posthog]'),
  },
};

// ── harness ───────────────────────────────────────────────────────────────

const failures: string[] = [];
let currentScenario = '';

function fail(message: string): void {
  failures.push(`${currentScenario}: ${message}`);
  console.log(`  ✗ ${message}`);
}

function pass(message: string): void {
  console.log(`  ✔ ${message}`);
}

function check(condition: boolean, message: string): boolean {
  if (condition) pass(message);
  else fail(message);
  return condition;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(binary: string, args: string[]): Run {
  const r = spawnSync(binary, args, { encoding: 'utf-8' });
  return {
    status: r.error ? -1 : r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

/** `wizard <args>` against the built binary, inheriting the sandbox HOME. */
function wizard(...args: string[]): Run {
  return run(process.execPath, [WIZARD, ...args]);
}

/**
 * The non-interactive install. Reuses the run pipeline's headless flag, so the
 * name is imported rather than spelled out — see @lib/headless-mode.
 */
function mcpAdd(...extra: string[]): Run {
  return wizard('mcp', 'add', `--${HEADLESS_FLAG}`, ...extra);
}

function mcpRemove(): Run {
  return wizard('mcp', 'remove', `--${HEADLESS_FLAG}`);
}

/**
 * `os.homedir()` reads $HOME on POSIX and both editor CLIs store config under
 * it, so one env var isolates the wizard and the CLI it shells out to. A
 * pristine dir per scenario is what a first-time user actually has.
 */
async function withSandboxHome(
  spec: ProviderSpec,
  fn: (home: string) => Promise<void>,
): Promise<void> {
  const realHome = process.env.HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-mcp-'));
  const before = failures.length;
  process.env.HOME = home;
  try {
    await fn(home);
  } finally {
    // The sandbox is about to go and CI has nothing else to look at.
    if (failures.length > before && spec.configPath) {
      const contents = readIfPresent(path.join(home, spec.configPath));
      console.log(
        contents === null
          ? `  ── ${spec.configPath} was never written ──`
          : `  ── ${spec.configPath} ──\n${contents.replace(/^/gm, '  │ ')}`,
      );
    }
    process.env.HOME = realHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function seed(home: string, relative: string, contents: string): void {
  const target = path.join(home, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function readIfPresent(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

/** Asserts a clean exit, quoting the reason only when it failed. */
function checkRun(r: Run, label: string): boolean {
  if (r.status === 0) return check(true, label);
  const lines = (r.stderr + r.stdout)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // The step prints failures as `- <client> — <detail>` under a success header,
  // so the first line is usually the wrong one to quote.
  const reason =
    lines.find((l) => l.includes('—')) ?? lines[0] ?? `exit ${r.status}`;
  return check(false, `${label} — ${reason}`);
}

// ── scenarios ─────────────────────────────────────────────────────────────

/** A fresh box has no editor config directory at all — the write must create it. */
async function scenarioFreshInstall(spec: ProviderSpec): Promise<void> {
  await withSandboxHome(spec, async (home) => {
    check(!spec.isInstalled(), 'reports not-installed on a fresh HOME');

    const r = mcpAdd();
    if (!checkRun(r, 'mcp add exits 0')) return;
    check(spec.isInstalled(), 'the editor reports the server installed');

    if (spec.configPath) {
      const contents = readIfPresent(path.join(home, spec.configPath));
      if (!check(contents !== null, `wrote ${spec.configPath}`)) return;
      // Match the whole configured value, not a URL substring — `includes`
      // on a bare URL also accepts hosts that merely embed it.
      check(
        contents!.includes(`"${MCP_URL}"`),
        'the written config carries exactly the MCP url',
      );
      check(
        /startup_timeout_sec\s*=/.test(contents!),
        'the written config carries a startup timeout',
      );
    }
  });
}

/**
 * A config the wizard is happy with and the editor rejects is the worst case:
 * we report "installed" and the user loses every server in the file.
 */
async function scenarioEditorAcceptsConfig(spec: ProviderSpec): Promise<void> {
  await withSandboxHome(spec, async () => {
    const r = mcpAdd();
    if (!checkRun(r, 'mcp add exits 0')) return;

    check(
      run(spec.binary, ['mcp', 'list']).status === 0,
      `${spec.binary} mcp list parses the config (exit 0)`,
    );
  });
}

/** Re-running the wizard is the common case, not the edge case. */
async function scenarioIdempotent(spec: ProviderSpec): Promise<void> {
  await withSandboxHome(spec, async (home) => {
    const first = mcpAdd();
    if (!checkRun(first, 'first add exits 0')) return;

    const second = mcpAdd();
    checkRun(second, 'second add exits 0');
    check(
      /already installed|nothing changed/i.test(second.stdout + second.stderr),
      'second add reports it changed nothing',
    );

    if (spec.configPath) {
      const contents = readIfPresent(path.join(home, spec.configPath)) ?? '';
      const sections = contents.match(/^\s*\[mcp_servers\.posthog\]/gm) ?? [];
      // Two definitions of one TOML table is a parse error on the whole file.
      check(
        sections.length === 1,
        `exactly one [mcp_servers.posthog] section (found ${sections.length})`,
      );
      check(
        run(spec.binary, ['mcp', 'list']).status === 0,
        'the editor still parses the config after a re-run',
      );
    }
  });
}

/**
 * `--features` is a documented flag. Honouring it or rejecting it are both
 * defensible; accepting it and installing full scope anyway is not.
 */
async function scenarioFeaturesFlag(spec: ProviderSpec): Promise<void> {
  await withSandboxHome(spec, async (home) => {
    const r = mcpAdd('--features', 'flags,insights');
    if (!checkRun(r, 'mcp add --features exits 0')) return;

    // Claude Code owns its own store, so read the URL back through its CLI.
    const url = spec.configPath
      ? readIfPresent(path.join(home, spec.configPath)) ?? ''
      : run(spec.binary, ['mcp', 'get', 'posthog']).stdout;

    check(
      url.includes('features=flags,insights'),
      'the installed URL carries the requested features',
    );
  });
}

/** The update path is separate code from the create path, and can no-op silently. */
async function scenarioUpdatesExistingEntry(spec: ProviderSpec): Promise<void> {
  if (!spec.configPath) return;

  await withSandboxHome(spec, async (home) => {
    seed(
      home,
      spec.configPath!,
      [
        '[mcp_servers.unrelated]',
        'command = "some-other-server"',
        '',
        '[mcp_servers.posthog]',
        'url = "https://mcp.posthog.com/mcp?features=flags"',
        'startup_timeout_sec = 30',
        '',
      ].join('\n'),
    );

    const r = mcpAdd();
    if (!checkRun(r, 'mcp add exits 0')) return;

    const contents = readIfPresent(path.join(home, spec.configPath!)) ?? '';
    check(
      contents.includes(`url = "${MCP_URL}"`),
      'the stale features URL was replaced',
    );
    check(
      contents.includes('[mcp_servers.unrelated]'),
      "an unrelated user's server survived the write",
    );
    check(
      run(spec.binary, ['mcp', 'list']).status === 0,
      'the editor still parses the config after an update',
    );
  });
}

/**
 * TOML does not care about key order, so anything assuming `url` sits on the
 * line after the header reads this as "no match".
 */
async function scenarioUpdatesReorderedEntry(
  spec: ProviderSpec,
): Promise<void> {
  if (!spec.configPath) return;

  await withSandboxHome(spec, async (home) => {
    seed(
      home,
      spec.configPath!,
      [
        '[mcp_servers.posthog]',
        'startup_timeout_sec = 30',
        'url = "https://mcp.posthog.com/mcp?features=flags"',
        '',
      ].join('\n'),
    );

    const r = mcpAdd();
    const contents = readIfPresent(path.join(home, spec.configPath!)) ?? '';

    // Rewrite it or refuse and say so; claiming success without writing is the
    // only outcome that isn't defensible.
    if (r.status !== 0) {
      pass("declined to edit a key order it can't handle");
    } else {
      check(
        contents.includes(`url = "${MCP_URL}"`),
        'a reported success actually replaced the stale URL',
      );
    }
  });
}

/**
 * TOML permits a quoted table key. A substring scan for the bare form misses it
 * and appends a second definition of the same table.
 */
async function scenarioQuotedTableKey(spec: ProviderSpec): Promise<void> {
  if (!spec.configPath) return;

  await withSandboxHome(spec, async (home) => {
    seed(
      home,
      spec.configPath!,
      ['[mcp_servers."posthog"]', `url = "${MCP_URL}"`, ''].join('\n'),
    );

    mcpAdd();

    check(
      run(spec.binary, ['mcp', 'list']).status === 0,
      'the editor still parses a config that used a quoted table key',
    );
  });
}

/** `mcp remove` reporting success while leaving the server in place is the bug. */
async function scenarioRemove(spec: ProviderSpec): Promise<void> {
  await withSandboxHome(spec, async () => {
    const added = mcpAdd();
    if (!checkRun(added, 'mcp add exits 0')) return;

    const removed = mcpRemove();
    if (!checkRun(removed, 'mcp remove exits 0')) return;

    check(!spec.isInstalled(), 'the editor reports the server gone');
  });
}

/**
 * The wizard prints a login command for the user to run by hand. If the editor
 * renames that subcommand, nothing else in the build notices.
 */
async function scenarioLoginCommandExists(spec: ProviderSpec): Promise<void> {
  const probe = run(spec.binary, spec.loginProbe);
  check(
    probe.status === 0,
    `${spec.binary} ${spec.loginProbe.join(' ')} exists (exit 0)`,
  );
}

// ── runner ────────────────────────────────────────────────────────────────

const SCENARIOS: Array<{
  name: string;
  run: (spec: ProviderSpec) => Promise<void>;
}> = [
  { name: 'fresh install on an empty HOME', run: scenarioFreshInstall },
  {
    name: 'the editor can parse what we wrote',
    run: scenarioEditorAcceptsConfig,
  },
  { name: 're-running the install is a no-op', run: scenarioIdempotent },
  { name: '--features reaches the installed URL', run: scenarioFeaturesFlag },
  { name: 'updates an existing entry', run: scenarioUpdatesExistingEntry },
  {
    name: 'updates an entry with reordered keys',
    run: scenarioUpdatesReorderedEntry,
  },
  { name: 'survives a quoted TOML table key', run: scenarioQuotedTableKey },
  { name: 'remove actually removes', run: scenarioRemove },
  {
    name: 'the login command it prints exists',
    run: scenarioLoginCommandExists,
  },
];

function parseProvider(): Provider {
  const arg = process.argv
    .find((a) => a.startsWith('--provider='))
    ?.split('=')[1];
  if (!arg || !(PROVIDERS as readonly string[]).includes(arg)) {
    console.error(`Pass --provider=<${PROVIDERS.join('|')}>.`);
    process.exit(2);
  }
  return arg as Provider;
}

async function main(): Promise<void> {
  const provider = parseProvider();
  const spec = SPECS[provider];

  if (!fs.existsSync(WIZARD)) {
    console.error(`✗ ${WIZARD} not found — run \`pnpm build\` first.`);
    process.exit(1);
  }

  // Hard failure, not a skip — a skipped matrix leg looks green on the PR page.
  let version: string;
  try {
    version = execFileSync(spec.binary, ['--version'], { encoding: 'utf-8' })
      .trim()
      .split('\n')[0]!;
  } catch (err) {
    console.error(
      `✗ ${spec.binary} is not runnable on this machine — ${
        (err as Error).message
      }`,
    );
    process.exit(1);
  }

  console.log(`\nMCP install smoke test — ${provider} (${version})\n`);

  for (const scenario of SCENARIOS) {
    currentScenario = scenario.name;
    console.log(`▸ ${scenario.name}`);
    try {
      await scenario.run(spec);
    } catch (err) {
      fail(`threw — ${(err as Error).message}`);
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n✗ MCP install smoke test FAILED for ${provider} (${failures.length}):`,
    );
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `\n✔ MCP install smoke test passed for ${provider} (${SCENARIOS.length} scenarios)`,
  );
}

main().catch((err) => {
  console.error('MCP install smoke test crashed:', err);
  process.exit(1);
});
