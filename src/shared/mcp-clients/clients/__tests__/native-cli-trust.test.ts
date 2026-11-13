import * as fs from 'node:fs';
import * as os from 'os';
import * as path from 'node:path';
import { ClaudeCodeMCPClient } from '@shared/mcp-clients/clients/claude-code';
import { CodexMCPClient } from '@shared/mcp-clients/clients/codex';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: vi.fn(actual.homedir) };
});
vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn(), wizardCapture: vi.fn() },
}));
vi.mock('@utils/debug');

describe('MCP CLI interpreter trust', () => {
  const originalHome = os.homedir();
  let tmp: string;
  let project: string;
  let home: string;
  let system: string;
  let bin: string;
  let marker: string;
  let calls: string;

  const cli = (file: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(
        calls,
      )}, JSON.stringify({ args: process.argv.slice(2), path: process.env.PATH, token: process.env.POSTHOG_AUTH_HEADER }) + '\\n');
console.log(process.argv.includes('--json') ? '[]' : '3.0.0');
`,
      { mode: 0o755 },
    );
    if (process.platform === 'win32') {
      fs.writeFileSync(
        `${file}.cmd`,
        `@node "%~dp0\\${path.basename(file)}" %*\r\n`,
      );
    }
  };

  const readCalls = (): { args: string[]; path: string; token?: string }[] =>
    fs
      .readFileSync(calls, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

  beforeEach(() => {
    tmp = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cli-trust-')),
    );
    project = path.join(tmp, 'project');
    home = path.join(tmp, 'home');
    system = path.join(tmp, 'installed tools');
    bin = path.join(project, 'node_modules', '.bin');
    marker = path.join(tmp, 'project-node-ran');
    calls = path.join(tmp, 'cli-calls.jsonl');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(home);
    fs.mkdirSync(system);
    fs.writeFileSync(
      path.join(bin, 'node'),
      `#!/bin/sh\nprintf ran > "${marker}"\n`,
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(bin, 'node.cmd'), `@echo ran>"${marker}"\r\n`);
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    vi.mocked(os.homedir).mockReturnValue(home);
    vi.stubEnv(
      'PATH',
      [bin, system, path.dirname(process.execPath)].join(path.delimiter),
    );
    vi.stubEnv('POSTHOG_AUTH_HEADER', '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(os.homedir).mockReturnValue(originalHome);
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('protects synchronous and asynchronous Claude calls from a project-local node', async () => {
    cli(path.join(home, '.claude', 'local', 'claude'));
    const client = new ClaudeCodeMCPClient();
    await expect(client.isClientSupported()).resolves.toBe(true);
    await expect(client.isServerInstalled()).resolves.toBe(true);
    await expect(client.addServer()).resolves.toMatchObject({ success: true });
    await expect(client.removeServer()).resolves.toMatchObject({
      success: true,
    });
    await expect(client.installPlugin()).resolves.toMatchObject({
      success: true,
    });
    const recorded = readCalls();
    expect(recorded.some((call) => call.args[0] === '--version')).toBe(true);
    expect(
      recorded.some(
        (call) => call.args.join(' ') === 'plugin install posthog@posthog',
      ),
    ).toBe(true);
    expect(
      recorded.every((call) => !call.path.split(path.delimiter).includes(bin)),
    ).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('protects Codex MCP and plugin calls while preserving its bearer-token environment', async () => {
    cli(path.join(system, 'codex'));
    const client = new CodexMCPClient();
    await expect(client.isClientSupported()).resolves.toBe(true);
    await expect(client.addServer('test-key')).resolves.toMatchObject({
      success: true,
    });
    await expect(client.removeServer()).resolves.toMatchObject({
      success: true,
    });
    await expect(client.installPlugin()).resolves.toMatchObject({
      success: true,
    });
    const recorded = readCalls();
    expect(recorded[0].token).toBe('Bearer test-key');
    expect(
      recorded.some(
        (call) => call.args.join(' ') === 'plugin add posthog@posthog',
      ),
    ).toBe(true);
    expect(
      recorded.every((call) => !call.path.split(path.delimiter).includes(bin)),
    ).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
