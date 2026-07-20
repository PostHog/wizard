import { OpenCodeMCPClient } from '@steps/add-mcp-server-to-clients/clients/opencode';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof fs>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
    },
  };
});

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

vi.mock('@env', () => ({
  runtimeEnv: vi.fn(),
}));

vi.mock('@utils/debug', () => ({
  debug: vi.fn(),
}));

describe('OpenCodeMCPClient', () => {
  const execSyncMock = execSync as Mock;
  const existsSyncMock = fs.existsSync as Mock;
  const mkdirMock = fs.promises.mkdir as Mock;
  const readFileMock = fs.promises.readFile as Mock;
  const writeFileMock = fs.promises.writeFile as Mock;

  let runtimeEnvMock: Mock;

  beforeAll(async () => {
    const env = await vi.importMock<{ runtimeEnv: Mock }>('@env');
    runtimeEnvMock = env.runtimeEnv;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/home/testuser');
    runtimeEnvMock.mockReturnValue(undefined);
  });

  describe('isClientSupported', () => {
    it('returns true when opencode is in PATH', async () => {
      execSyncMock.mockReturnValue(Buffer.from('/usr/local/bin/opencode\n'));
      const client = new OpenCodeMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(execSyncMock).toHaveBeenCalledWith('command -v opencode', {
        stdio: 'pipe',
      });
    });

    it('returns false when opencode is not in PATH', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('command not found');
      });
      const client = new OpenCodeMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(false);
    });

    it('memoizes the binary path after first detection', async () => {
      execSyncMock.mockReturnValue(Buffer.from('/usr/local/bin/opencode\n'));
      const client = new OpenCodeMCPClient();
      await client.isClientSupported();
      await client.isClientSupported();
      expect(execSyncMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('getConfigPath', () => {
    it('uses OPENCODE_CONFIG_DIR when set', async () => {
      runtimeEnvMock.mockReturnValue('/custom/config');
      existsSyncMock.mockReturnValue(false);
      const client = new OpenCodeMCPClient();
      const configPath = await client.getConfigPath();
      expect(configPath).toBe('/custom/config/opencode.json');
    });

    it('prefers opencode.jsonc over opencode.json when both exist', async () => {
      runtimeEnvMock.mockReturnValue(undefined);
      vi.mocked(os.homedir).mockReturnValue('/home/testuser');
      existsSyncMock.mockImplementation((p: string) =>
        p.endsWith('opencode.jsonc'),
      );
      const client = new OpenCodeMCPClient();
      const configPath = await client.getConfigPath();
      expect(configPath).toBe('/home/testuser/.config/opencode/opencode.jsonc');
    });

    it('falls back to opencode.json when jsonc does not exist', async () => {
      runtimeEnvMock.mockReturnValue(undefined);
      existsSyncMock.mockReturnValue(false);
      const client = new OpenCodeMCPClient();
      const configPath = await client.getConfigPath();
      expect(configPath).toBe('/home/testuser/.config/opencode/opencode.json');
    });

    it('uses XDG_CONFIG_HOME when set and no OPENCODE_CONFIG_DIR', async () => {
      runtimeEnvMock.mockImplementation((key: string) => {
        if (key === 'XDG_CONFIG_HOME') return '/xdg/config';
        return undefined;
      });
      existsSyncMock.mockReturnValue(false);
      const client = new OpenCodeMCPClient();
      const configPath = await client.getConfigPath();
      expect(configPath).toBe('/xdg/config/opencode/opencode.json');
    });
  });

  describe('getServerPropertyName', () => {
    it('returns mcp', () => {
      const client = new OpenCodeMCPClient();
      expect(client.getServerPropertyName()).toBe('mcp');
    });
  });

  describe('addServer (inherited from DefaultMCPClient)', () => {
    it('writes server config with type:remote to the config file', async () => {
      existsSyncMock.mockReturnValue(false);
      readFileMock.mockRejectedValue(new Error('should not be called'));
      writeFileMock.mockResolvedValue(undefined);
      mkdirMock.mockResolvedValue(undefined);

      const client = new OpenCodeMCPClient();
      await expect(client.addServer('phx_test123')).resolves.toEqual({
        success: true,
      });

      const writtenContent = writeFileMock.mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed).toEqual({
        mcp: {
          posthog: {
            type: 'remote',
            url: 'https://mcp.posthog.com/mcp',
            headers: {
              Authorization: 'Bearer phx_test123',
            },
          },
        },
      });
    });

    it('writes without headers when no apiKey provided', async () => {
      existsSyncMock.mockReturnValue(false);
      writeFileMock.mockResolvedValue(undefined);
      mkdirMock.mockResolvedValue(undefined);

      const client = new OpenCodeMCPClient();
      await expect(client.addServer()).resolves.toEqual({ success: true });

      const writtenContent = writeFileMock.mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed.mcp.posthog.type).toBe('remote');
      expect(parsed.mcp.posthog.url).toBe('https://mcp.posthog.com/mcp');
      expect(parsed.mcp.posthog.headers).toBeUndefined();
    });

    it('uses posthog-local for local server', async () => {
      existsSyncMock.mockReturnValue(false);
      writeFileMock.mockResolvedValue(undefined);
      mkdirMock.mockResolvedValue(undefined);

      const client = new OpenCodeMCPClient();
      await expect(
        client.addServer(undefined, undefined, true),
      ).resolves.toEqual({ success: true });

      const writtenContent = writeFileMock.mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed.mcp['posthog-local']).toBeDefined();
      expect(parsed.mcp['posthog-local'].url).toContain('localhost');
    });
  });

  describe('isServerInstalled (inherited from DefaultMCPClient)', () => {
    it('returns true when posthog server exists in config', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          mcp: {
            posthog: { type: 'remote', url: 'https://mcp.posthog.com/mcp' },
          },
        }),
      );
      const client = new OpenCodeMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when config file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);
      const client = new OpenCodeMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('removeServer (inherited from DefaultMCPClient)', () => {
    it('removes posthog server from config', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          mcp: {
            posthog: { type: 'remote', url: 'https://mcp.posthog.com/mcp' },
            'other-server': { type: 'remote', url: 'https://example.com' },
          },
        }),
      );
      writeFileMock.mockResolvedValue(undefined);

      const client = new OpenCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: true });

      const writtenContent = writeFileMock.mock.calls[0][1];
      expect(writtenContent).not.toContain('posthog');
      expect(writtenContent).toContain('other-server');
    });

    it('returns false when config file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);
      const client = new OpenCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: false });
    });
  });
});
