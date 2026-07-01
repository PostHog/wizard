import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OpenCodeMCPClient } from '@steps/add-mcp-server-to-clients/clients/opencode';

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
  existsSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn(),
}));

describe('OpenCodeMCPClient', () => {
  let client: OpenCodeMCPClient;
  const mockHomeDir = '/mock/home';
  const mockApiKey = 'phx_test123';

  const mkdirMock = fs.promises.mkdir as Mock;
  const readFileMock = fs.promises.readFile as Mock;
  const writeFileMock = fs.promises.writeFile as Mock;
  const existsSyncMock = fs.existsSync as Mock;
  const homedirMock = os.homedir as Mock;

  const originalPlatform = process.platform;
  const originalXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    client = new OpenCodeMCPClient();
    vi.clearAllMocks();
    homedirMock.mockReturnValue(mockHomeDir);
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
    });
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
  });

  describe('constructor', () => {
    it('sets the OpenCode name', () => {
      expect(client.name).toBe('OpenCode');
    });
  });

  describe('isClientSupported', () => {
    it.each(['darwin', 'linux', 'win32'])(
      'is supported on %s',
      async (platform) => {
        Object.defineProperty(process, 'platform', {
          value: platform,
          writable: true,
        });
        await expect(client.isClientSupported()).resolves.toBe(true);
      },
    );

    it('is unsupported on freebsd', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'freebsd',
        writable: true,
      });
      await expect(client.isClientSupported()).resolves.toBe(false);
    });
  });

  describe('getConfigPath', () => {
    it('returns ~/.config/opencode/opencode.json on darwin', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
      await expect(client.getConfigPath()).resolves.toBe(
        path.join(mockHomeDir, '.config', 'opencode', 'opencode.json'),
      );
    });

    it('respects XDG_CONFIG_HOME on linux when set', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });
      process.env.XDG_CONFIG_HOME = '/custom/xdg';
      await expect(client.getConfigPath()).resolves.toBe(
        path.join('/custom/xdg', 'opencode', 'opencode.json'),
      );
    });

    it('falls back to ~/.config on linux without XDG_CONFIG_HOME', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });
      await expect(client.getConfigPath()).resolves.toBe(
        path.join(mockHomeDir, '.config', 'opencode', 'opencode.json'),
      );
    });

    it('returns ~/.config/opencode/opencode.json on win32', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });
      await expect(client.getConfigPath()).resolves.toBe(
        path.join(mockHomeDir, '.config', 'opencode', 'opencode.json'),
      );
    });
  });

  describe('addServer', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
    });

    it('writes a remote MCP entry under the "mcp" key with auth header when apiKey provided', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer(mockApiKey);

      const expectedPath = path.join(
        mockHomeDir,
        '.config',
        'opencode',
        'opencode.json',
      );
      expect(mkdirMock).toHaveBeenCalledWith(path.dirname(expectedPath), {
        recursive: true,
      });
      expect(writeFileMock).toHaveBeenCalledTimes(1);
      const [, written] = writeFileMock.mock.calls[0]!;
      const parsed = JSON.parse(written as string);
      expect(parsed).toEqual({
        mcp: {
          posthog: {
            type: 'remote',
            url: 'https://mcp.posthog.com/mcp',
            headers: { Authorization: `Bearer ${mockApiKey}` },
          },
        },
      });
    });

    it('writes a remote MCP entry without headers when no apiKey (OAuth mode)', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer(undefined);

      const [, written] = writeFileMock.mock.calls[0]!;
      const parsed = JSON.parse(written as string);
      expect(parsed.mcp.posthog).toEqual({
        type: 'remote',
        url: 'https://mcp.posthog.com/mcp',
      });
      expect(parsed.mcp.posthog).not.toHaveProperty('headers');
    });

    it('uses posthog-local server name and localhost url when local=true', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer(undefined, undefined, true);

      const [, written] = writeFileMock.mock.calls[0]!;
      const parsed = JSON.parse(written as string);
      expect(parsed.mcp['posthog-local']).toEqual({
        type: 'remote',
        url: 'http://localhost:8787/mcp',
      });
    });

    it('merges into existing mcp block and preserves siblings', async () => {
      existsSyncMock.mockReturnValue(true);
      const existing = {
        $schema: 'https://opencode.ai/config.json',
        model: 'anthropic/claude-sonnet-4-5',
        mcp: {
          other: { type: 'remote', url: 'https://other.example/mcp' },
        },
      };
      readFileMock.mockResolvedValue(JSON.stringify(existing, null, 2));

      await client.addServer(mockApiKey);

      const [, written] = writeFileMock.mock.calls[0]!;
      const parsed = JSON.parse(written as string);
      expect(parsed.$schema).toBe('https://opencode.ai/config.json');
      expect(parsed.model).toBe('anthropic/claude-sonnet-4-5');
      expect(parsed.mcp.other).toEqual({
        type: 'remote',
        url: 'https://other.example/mcp',
      });
      expect(parsed.mcp.posthog).toEqual({
        type: 'remote',
        url: 'https://mcp.posthog.com/mcp',
        headers: { Authorization: `Bearer ${mockApiKey}` },
      });
    });

    it('is idempotent: running twice yields a single posthog entry', async () => {
      // First write — no existing file
      existsSyncMock.mockReturnValueOnce(false);
      await client.addServer(mockApiKey);
      const firstWritten = writeFileMock.mock.calls[0]![1] as string;

      // Second invocation — file now exists with the prior content
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(firstWritten);

      await client.addServer(mockApiKey);
      const secondWritten = writeFileMock.mock.calls[1]![1] as string;
      const parsed = JSON.parse(secondWritten);
      expect(Object.keys(parsed.mcp)).toEqual(['posthog']);
      expect(parsed.mcp.posthog).toEqual({
        type: 'remote',
        url: 'https://mcp.posthog.com/mcp',
        headers: { Authorization: `Bearer ${mockApiKey}` },
      });
    });
  });

  describe('isServerInstalled', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
    });

    it('returns false when config file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });

    it('returns true when posthog server is present under mcp', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          mcp: {
            posthog: { type: 'remote', url: 'https://mcp.posthog.com/mcp' },
          },
        }),
      );
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when only other servers are configured', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          mcp: { other: { type: 'remote', url: 'https://other.example' } },
        }),
      );
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });

    it('returns true for posthog-local when local=true', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          mcp: {
            'posthog-local': {
              type: 'remote',
              url: 'http://localhost:8787/mcp',
            },
          },
        }),
      );
      await expect(client.isServerInstalled(true)).resolves.toBe(true);
    });
  });

  describe('removeServer', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
    });

    it('removes only the posthog entry and preserves siblings', async () => {
      existsSyncMock.mockReturnValue(true);
      const existing = {
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          posthog: {
            type: 'remote',
            url: 'https://mcp.posthog.com/mcp',
          },
          other: { type: 'remote', url: 'https://other.example/mcp' },
        },
      };
      readFileMock.mockResolvedValue(JSON.stringify(existing, null, 2));

      const result = await client.removeServer();
      expect(result).toEqual({ success: true });
      const [, written] = writeFileMock.mock.calls[0]!;
      const parsed = JSON.parse(written as string);
      expect(parsed.mcp).not.toHaveProperty('posthog');
      expect(parsed.mcp.other).toEqual({
        type: 'remote',
        url: 'https://other.example/mcp',
      });
      expect(parsed.$schema).toBe('https://opencode.ai/config.json');
    });

    it('returns failure and does not write when posthog server is absent', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          mcp: { other: { type: 'remote', url: 'https://other.example' } },
        }),
      );
      const result = await client.removeServer();
      expect(result).toEqual({ success: false });
      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('returns failure when config file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);
      const result = await client.removeServer();
      expect(result).toEqual({ success: false });
      expect(writeFileMock).not.toHaveBeenCalled();
    });
  });
});
