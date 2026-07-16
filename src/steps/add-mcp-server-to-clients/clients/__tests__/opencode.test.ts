import { OpenCodeMCPClient } from '@steps/add-mcp-server-to-clients/clients/opencode';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

describe('OpenCodeMCPClient', () => {
  const spawnSyncMock = spawnSync as Mock;
  const existsSyncMock = fs.existsSync as Mock;
  const readFileSyncMock = fs.readFileSync as Mock;
  const writeFileSyncMock = fs.writeFileSync as Mock;
  const homedirMock = os.homedir as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    homedirMock.mockReturnValue('/home/testuser');
  });

  describe('isClientSupported', () => {
    it('returns true when opencode --version succeeds', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: Buffer.from('opencode v1.0.0\n'),
      });
      const client = new OpenCodeMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith('opencode', ['--version'], {
        stdio: 'pipe',
      });
    });

    it('returns false when opencode --version fails', async () => {
      spawnSyncMock.mockReturnValue({ status: 1, stdout: Buffer.from('') });
      const client = new OpenCodeMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(false);
    });

    it('returns false when opencode command throws', async () => {
      spawnSyncMock.mockImplementation(() => {
        throw new Error('command not found');
      });
      const client = new OpenCodeMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(false);
    });
  });

  describe('getConfigPath', () => {
    it('returns correct config path', async () => {
      const client = new OpenCodeMCPClient();
      const configPath = await client.getConfigPath();
      expect(configPath).toBe('/home/testuser/.config/opencode/opencode.json');
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when posthog server exists in config', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          mcp: {
            posthog: { type: 'remote', url: 'https://mcp.posthog.com/mcp' },
          },
        }),
      );
      const client = new OpenCodeMCPClient();
      expect(await client.isServerInstalled()).toBe(true);
    });

    it('returns true when posthog-local server exists in config', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          mcp: {
            'posthog-local': {
              type: 'remote',
              url: 'http://localhost:8080/mcp',
            },
          },
        }),
      );
      const client = new OpenCodeMCPClient();
      expect(await client.isServerInstalled(true)).toBe(true);
    });

    it('returns false when config file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);
      const client = new OpenCodeMCPClient();
      expect(await client.isServerInstalled()).toBe(false);
    });

    it('returns false when posthog server is not in config', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          mcp: {
            'other-server': { type: 'remote', url: 'https://example.com' },
          },
        }),
      );
      const client = new OpenCodeMCPClient();
      expect(await client.isServerInstalled()).toBe(false);
    });

    it('returns false when config file is invalid JSON', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockReturnValue('not valid json');
      const client = new OpenCodeMCPClient();
      expect(await client.isServerInstalled()).toBe(false);
    });
  });

  describe('addServer', () => {
    it('runs opencode mcp add with correct args', async () => {
      spawnSyncMock.mockReturnValue({ status: 0, stderr: Buffer.from('') });
      const client = new OpenCodeMCPClient();
      await expect(client.addServer('phx_test123')).resolves.toEqual({
        success: true,
      });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'opencode',
        [
          'mcp',
          'add',
          'posthog',
          '--url',
          'https://mcp.posthog.com/mcp',
          '--header',
          'Authorization=Bearer phx_test123',
        ],
        { stdio: 'pipe' },
      );
    });

    it('runs without --header when no apiKey provided', async () => {
      spawnSyncMock.mockReturnValue({ status: 0, stderr: Buffer.from('') });
      const client = new OpenCodeMCPClient();
      await expect(client.addServer()).resolves.toEqual({ success: true });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'opencode',
        ['mcp', 'add', 'posthog', '--url', 'https://mcp.posthog.com/mcp'],
        { stdio: 'pipe' },
      );
    });

    it('uses posthog-local for local server', async () => {
      spawnSyncMock.mockReturnValue({ status: 0, stderr: Buffer.from('') });
      const client = new OpenCodeMCPClient();
      await expect(
        client.addServer(undefined, undefined, true),
      ).resolves.toEqual({ success: true });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'opencode',
        [
          'mcp',
          'add',
          'posthog-local',
          '--url',
          expect.stringContaining('localhost'),
        ],
        { stdio: 'pipe' },
      );
    });

    it('returns false when opencode mcp add fails', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stderr: Buffer.from('Error: failed'),
      });
      const client = new OpenCodeMCPClient();
      await expect(client.addServer('phx_test123')).resolves.toEqual({
        success: false,
      });
    });
  });

  describe('removeServer', () => {
    it('removes posthog server from config', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          mcp: {
            posthog: { type: 'remote', url: 'https://mcp.posthog.com/mcp' },
            'other-server': { type: 'remote', url: 'https://example.com' },
          },
        }),
      );
      const client = new OpenCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: true });
      expect(writeFileSyncMock).toHaveBeenCalledWith(
        expect.stringContaining('opencode.json'),
        expect.not.stringContaining('"posthog"'),
        'utf8',
      );
    });

    it('removes posthog-local server from config', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          mcp: {
            'posthog-local': {
              type: 'remote',
              url: 'http://localhost:8080/mcp',
            },
          },
        }),
      );
      const client = new OpenCodeMCPClient();
      await expect(client.removeServer(true)).resolves.toEqual({
        success: true,
      });
    });

    it('returns false when config file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);
      const client = new OpenCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: false });
    });

    it('returns false when server is not in config', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockReturnValue(
        JSON.stringify({
          mcp: {
            'other-server': { type: 'remote', url: 'https://example.com' },
          },
        }),
      );
      const client = new OpenCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: false });
    });

    it('returns false on invalid config', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileSyncMock.mockReturnValue('invalid json');
      const client = new OpenCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: false });
    });
  });
});
