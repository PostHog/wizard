import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import { spawnSync } from 'node:child_process';
import {
  detectStoredClaudeLogin,
  hasStoredClaudeLogin,
  isolatedAgentCredentialEnv,
} from '../stored-login';
import { isBlockedAgentEnvKey } from '../agent-env-isolation';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));

const spawnSyncMock = spawnSync as unknown as Mock;

describe('detectStoredClaudeLogin', () => {
  let home: string;

  beforeEach(() => {
    vi.clearAllMocks();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-stored-login-'));
    delete process.env.CLAUDE_CONFIG_DIR;
    // Default: keychain item absent (non-zero exit).
    spawnSyncMock.mockReturnValue({ status: 1 });
  });

  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR;
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('detects ~/.claude/.credentials.json', () => {
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');

    const result = detectStoredClaudeLogin(home, 'linux');

    expect(result.credentialsFile).toBe(true);
    expect(hasStoredClaudeLogin(result)).toBe(true);
  });

  it('reports nothing when there is no login and the platform is not macOS', () => {
    const result = detectStoredClaudeLogin(home, 'linux');

    expect(result).toEqual({ credentialsFile: false, keychain: false });
    expect(hasStoredClaudeLogin(result)).toBe(false);
    // Keychain is macOS-only — never shell out on other platforms.
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('honors CLAUDE_CONFIG_DIR when locating the credentials file', () => {
    const configDir = path.join(home, 'custom-config');
    fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(configDir, '.credentials.json'), '{}');
    process.env.CLAUDE_CONFIG_DIR = configDir;

    // The default ~/.claude has no creds file, so a hit proves CLAUDE_CONFIG_DIR won.
    expect(detectStoredClaudeLogin(home, 'linux').credentialsFile).toBe(true);
  });

  it('detects the macOS keychain login by existence only — never reads the secret', () => {
    spawnSyncMock.mockReturnValue({ status: 0 });

    const result = detectStoredClaudeLogin(home, 'darwin');

    expect(result.keychain).toBe(true);
    expect(hasStoredClaudeLogin(result)).toBe(true);

    const [cmd, args] = spawnSyncMock.mock.calls[0]!;
    expect(cmd).toBe('security');
    expect(args).toContain('find-generic-password');
    expect(args).toContain('Claude Code-credentials');
    // `-w` / `-g` would print the password — must never be requested.
    expect(args).not.toContain('-w');
    expect(args).not.toContain('-g');
  });

  it('treats a missing keychain item as no login', () => {
    spawnSyncMock.mockReturnValue({ status: 44 });
    expect(detectStoredClaudeLogin(home, 'darwin').keychain).toBe(false);
  });
});

describe('isolatedAgentCredentialEnv', () => {
  const created: string[] = [];

  const take = () => {
    const env = isolatedAgentCredentialEnv();
    created.push(env.CLAUDE_CONFIG_DIR);
    return env;
  };

  afterEach(() => {
    for (const dir of created.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  it('creates a fresh, empty directory that holds no stored login', () => {
    const dir = take().CLAUDE_CONFIG_DIR;

    // Empty: no `.credentials.json` for the SDK to resolve a stored login from.
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('isolates the secure store too, so the macOS keychain lookup misses', () => {
    const env = take();

    // The binary names the keychain item after this dir, so pointing it at the
    // throwaway dir is what keeps `Claude Code-credentials` out of reach.
    expect(env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe(env.CLAUDE_CONFIG_DIR);
    // Outside the ANTHROPIC_*/CLAUDE_CODE_* strip, so it must be set, not merely
    // inherited — a shell value would otherwise undo the isolation.
    expect(isBlockedAgentEnvKey('CLAUDE_SECURESTORAGE_CONFIG_DIR')).toBe(false);
  });

  it('returns a distinct directory on each call so concurrent runs never share', () => {
    expect(take().CLAUDE_CONFIG_DIR).not.toBe(take().CLAUDE_CONFIG_DIR);
  });
});
