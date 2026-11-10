import fs from 'fs';
import os from 'os';
import path from 'path';
import { evaluateBashCommand } from '@agent/bash-fence';

describe('package manager directory flags', () => {
  let base: string;
  let root: string;
  const allowed = (command: string, projectRoot: string | undefined = root) =>
    evaluateBashCommand(command, { projectRoot }).allowed;

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'fence-dir-'));
    root = path.join(base, 'project');
    fs.mkdirSync(path.join(root, 'mcp-server'), { recursive: true });
    fs.mkdirSync(path.join(base, 'outside'));
    fs.symlinkSync(path.join(base, 'outside'), path.join(root, 'link'));
  });
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  it.each([
    'pnpm --dir mcp-server add @posthog/mcp',
    'pnpm --dir=mcp-server add @posthog/mcp',
    'pnpm -C mcp-server install',
    'pnpm -C mcp-server run build',
    'pnpm --dir ./mcp-server build',
    'pnpm --dir . install',
    'pnpm add posthog-node --dir mcp-server',
    'npm --prefix mcp-server install posthog-node',
    'npm install posthog-node --prefix mcp-server',
    'yarn --cwd mcp-server add posthog-node',
    'bun --cwd mcp-server add posthog-node',
    'pnpm --dir not-created-yet install',
    'pnpm --dir mcp-server exec eslint src',
    'pnpm --dir mcp-server list @modelcontextprotocol/sdk',
    'npm --prefix mcp-server ls posthog-node',
    'pnpm --filter web --dir mcp-server add posthog-js',
  ])('allows %s', (command) => {
    expect(allowed(command)).toBe(true);
  });

  it.each([
    'pnpm --dir .. add x',
    'pnpm --dir ../outside add x',
    'pnpm --dir mcp-server/../../outside add x',
    'pnpm --dir=../outside add x',
    'pnpm -C /tmp add x',
    'pnpm --dir link add x',
    'pnpm --dir link/nested add x',
    'pnpm --dir ~ add x',
    'pnpm --dir "../outside" add x',
    "pnpm --dir 'mcp-server' add x",
    'pnpm --dir m* add x',
    'pnpm --dir --filter add x',
    'pnpm install --dir',
    'pnpm add x --dir ../outside',
    'pnpm list --dir ../outside',
    'pnpm add x --dir=../outside',
    'npm install x --prefix /tmp',
    'npm --prefix ../outside install x',
    'yarn --cwd ../outside add x',
    'bun add x --cwd ../outside',
  ])('denies %s', (command) => {
    expect(allowed(command)).toBe(false);
  });

  it('keeps the subcommand limits inside a project directory', () => {
    expect(allowed('pnpm --dir mcp-server publish')).toBe(false);
    expect(allowed('pnpm --dir mcp-server exec curl')).toBe(false);
    expect(allowed('pnpm --dir mcp-server run deploy')).toBe(false);
  });

  it('denies every directory flag with no project root', () => {
    expect(evaluateBashCommand('pnpm --dir mcp-server add x', {}).allowed).toBe(
      false,
    );
  });

  it('leaves tool arguments alone', () => {
    expect(allowed('pnpm exec prettier --cwd ../other src')).toBe(true);
    expect(allowed('pnpm run build -- --dir ../dist')).toBe(true);
  });

  it('still allows a command with no directory flag and no project root', () => {
    expect(evaluateBashCommand('pnpm add x', {}).allowed).toBe(true);
  });
});
