import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Mock } from 'vitest';

import {
  CLI_STEERING_TARGETS,
  detectTargets,
  findTarget,
  installOrUpdatePostHogCli,
  installSteeringSnippet,
} from '@steps/install-cli-steering';

vi.mock('../../../utils/debug');
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

const spawnSyncMock = childProcess.spawnSync as Mock;
const existsSyncMock = fs.existsSync as Mock;

describe('install-cli-steering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('targets', () => {
    it('maps each agent to a global instructions file under the home directory', () => {
      const home = os.homedir();
      expect(findTarget('claude-code')?.instructionsPath()).toBe(
        path.join(home, '.claude', 'CLAUDE.md'),
      );
      expect(findTarget('codex')?.instructionsPath()).toBe(
        path.join(home, '.codex', 'AGENTS.md'),
      );
      expect(findTarget('gemini')?.instructionsPath()).toBe(
        path.join(home, '.gemini', 'GEMINI.md'),
      );
    });

    it('returns undefined for unknown agent ids', () => {
      expect(findTarget('not-an-agent')).toBeUndefined();
    });

    it('detects agents by the presence of their home config directory', () => {
      existsSyncMock.mockImplementation((target) =>
        String(target).includes(path.join(os.homedir(), '.claude')),
      );

      const detected = detectTargets();
      expect(detected.map((t) => t.id)).toEqual(['claude-code']);
      expect(detected.length).toBeLessThan(CLI_STEERING_TARGETS.length);
    });
  });

  describe('installOrUpdatePostHogCli', () => {
    it('installs or updates the latest published CLI globally', () => {
      spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' });

      const result = installOrUpdatePostHogCli();

      expect(result).toEqual({ success: true });
      const [command, args, options] = spawnSyncMock.mock.calls[0];
      expect(command).toBe('npm');
      expect(args).toEqual(['install', '--global', '@posthog/cli@latest']);
      expect(options.encoding).toBe('utf-8');
    });

    it('surfaces stderr when npm exits non-zero', () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'Error: install failed\n',
      });

      const result = installOrUpdatePostHogCli();
      expect(result.success).toBe(false);
      expect(result.error).toContain('install failed');
    });

    it('explains when npm itself cannot be run', () => {
      spawnSyncMock.mockReturnValue({
        error: new Error('spawn npm ENOENT'),
        status: null,
      });

      const result = installOrUpdatePostHogCli();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Is Node.js installed?');
    });
  });

  describe('installSteeringSnippet', () => {
    it('delegates to the installed CLI with the experimental env set', () => {
      spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' });

      const result = installSteeringSnippet('/home/user/.claude/CLAUDE.md');

      expect(result).toEqual({
        success: true,
        filePath: '/home/user/.claude/CLAUDE.md',
      });
      const [command, args, options] = spawnSyncMock.mock.calls[0];
      expect(command).toBe('posthog-cli');
      expect(args).toEqual([
        'api',
        'agents-md',
        'install',
        '--path',
        '/home/user/.claude/CLAUDE.md',
      ]);
      expect(options.env.POSTHOG_CLI_EXPERIMENTAL_API).toBe('1');
    });

    it('surfaces stderr when the CLI exits non-zero', () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'Error: something broke\n',
      });

      const result = installSteeringSnippet('/tmp/AGENTS.md');
      expect(result.success).toBe(false);
      expect(result.error).toContain('something broke');
    });

    it('explains when posthog-cli itself cannot be run', () => {
      spawnSyncMock.mockReturnValue({
        error: new Error('spawn posthog-cli ENOENT'),
        status: null,
      });

      const result = installSteeringSnippet('/tmp/AGENTS.md');
      expect(result.success).toBe(false);
      expect(result.error).toContain('posthog-cli');
      expect(result.error).toContain('PATH');
    });
  });
});
