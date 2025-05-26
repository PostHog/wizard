import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CursorMCPClient } from '../cursor';
import { getDefaultServerConfig } from '../../defaults';

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
  existsSync: jest.fn(),
}));

jest.mock('os', () => ({
  homedir: jest.fn(),
}));

jest.mock('../../defaults', () => ({
  DefaultMCPClientConfig: {
    parse: jest.fn(),
  },
  getDefaultServerConfig: jest.fn(),
}));

jest.mock('lodash', () => ({
  merge: jest.fn(),
}));

describe('CursorMCPClient', () => {
  let client: CursorMCPClient;
  const mockHomeDir = '/mock/home';
  const mockApiKey = 'test-api-key';
  const mockServerConfig = {
    command: 'npx',
    args: ['-y', 'mcp-remote@latest'],
    env: { POSTHOG_AUTH_HEADER: `Bearer ${mockApiKey}` },
  };

  const mkdirMock = fs.promises.mkdir as jest.Mock;
  const readFileMock = fs.promises.readFile as jest.Mock;
  const writeFileMock = fs.promises.writeFile as jest.Mock;
  const existsSyncMock = fs.existsSync as jest.Mock;
  const homedirMock = os.homedir as jest.Mock;
  const getDefaultServerConfigMock = getDefaultServerConfig as jest.Mock;
  const mergeMock = require('lodash').merge as jest.Mock;

  const originalPlatform = process.platform;

  beforeEach(() => {
    client = new CursorMCPClient();
    jest.clearAllMocks();

    // Reset all mocks to their default implementations
    mkdirMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue('{}');
    writeFileMock.mockResolvedValue(undefined);
    existsSyncMock.mockReturnValue(false);
    homedirMock.mockReturnValue(mockHomeDir);
    getDefaultServerConfigMock.mockReturnValue(mockServerConfig);
    mergeMock.mockImplementation((target, ...sources) =>
      Object.assign(target, ...sources),
    );

    // Mock the Zod schema parse method
    const { DefaultMCPClientConfig } = require('../../defaults');
    DefaultMCPClientConfig.parse.mockImplementation((data: any) => data);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
    });
  });

  describe('constructor', () => {
    it('should set the correct name', () => {
      expect(client.name).toBe('Cursor');
    });
  });

  describe('isClientSupported', () => {
    it('should return true for macOS', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
      expect(client.isClientSupported()).toBe(true);
    });

    it('should return true for Windows', () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });
      expect(client.isClientSupported()).toBe(true);
    });

    it('should return false for Linux', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });
      expect(client.isClientSupported()).toBe(false);
    });

    it('should return false for other platforms', () => {
      Object.defineProperty(process, 'platform', {
        value: 'freebsd',
        writable: true,
      });
      expect(client.isClientSupported()).toBe(false);
    });
  });

  describe('getConfigPath', () => {
    it('should return correct path using homedir', () => {
      const configPath = (client as any).getConfigPath();
      expect(configPath).toBe(path.join(mockHomeDir, '.cursor', 'mcp.json'));
      expect(homedirMock).toHaveBeenCalled();
    });

    it('should work with different home directories', () => {
      const differentHome = '/different/home';
      homedirMock.mockReturnValue(differentHome);

      const configPath = (client as any).getConfigPath();
      expect(configPath).toBe(path.join(differentHome, '.cursor', 'mcp.json'));
    });
  });

  describe('isServerInstalled', () => {
    it('should return false when config file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);

      const result = await client.isServerInstalled();
      expect(result).toBe(false);
      expect(readFileMock).not.toHaveBeenCalled();
    });

    it('should return false when config file exists but posthog server is not configured', async () => {
      existsSyncMock.mockReturnValue(true);
      const configData = {
        mcpServers: {
          otherServer: mockServerConfig,
        },
      };
      readFileMock.mockResolvedValue(JSON.stringify(configData));

      const result = await client.isServerInstalled();
      expect(result).toBe(false);
    });

    it('should return true when posthog server is configured', async () => {
      existsSyncMock.mockReturnValue(true);
      const configData = {
        mcpServers: {
          posthog: mockServerConfig,
          otherServer: mockServerConfig,
        },
      };
      readFileMock.mockResolvedValue(JSON.stringify(configData));

      const result = await client.isServerInstalled();
      expect(result).toBe(true);
    });

    it('should return true when only posthog server is configured', async () => {
      existsSyncMock.mockReturnValue(true);
      const configData = {
        mcpServers: {
          posthog: mockServerConfig,
        },
      };
      readFileMock.mockResolvedValue(JSON.stringify(configData));

      const result = await client.isServerInstalled();
      expect(result).toBe(true);
    });

    it('should return false when config file is invalid JSON', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue('invalid json');

      const result = await client.isServerInstalled();
      expect(result).toBe(false);
    });

    it('should return false when config file is empty', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue('');

      const result = await client.isServerInstalled();
      expect(result).toBe(false);
    });

    it('should return false when readFile throws an error', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockRejectedValue(new Error('File read error'));

      const result = await client.isServerInstalled();
      expect(result).toBe(false);
    });

    it('should return false when Zod parsing fails', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(JSON.stringify({ invalid: 'config' }));

      const { DefaultMCPClientConfig } = require('../../defaults');
      DefaultMCPClientConfig.parse.mockImplementation(() => {
        throw new Error('Zod validation error');
      });

      const result = await client.isServerInstalled();
      expect(result).toBe(false);
    });

    it('should handle config with empty mcpServers', async () => {
      existsSyncMock.mockReturnValue(true);
      const configData = {
        mcpServers: {},
      };
      readFileMock.mockResolvedValue(JSON.stringify(configData));

      const result = await client.isServerInstalled();
      expect(result).toBe(false);
    });
  });

  describe('addServer', () => {
    it('should create config directory and add server when config file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);
      mergeMock.mockReturnValue({
        mcpServers: {
          posthog: mockServerConfig,
        },
      });

      await client.addServer(mockApiKey);

      const expectedConfigPath = path.join(mockHomeDir, '.cursor', 'mcp.json');
      const expectedConfigDir = path.dirname(expectedConfigPath);

      expect(mkdirMock).toHaveBeenCalledWith(expectedConfigDir, {
        recursive: true,
      });
      expect(mergeMock).toHaveBeenCalledWith(
        {},
        { mcpServers: {} },
        { mcpServers: { posthog: mockServerConfig } },
      );
      expect(writeFileMock).toHaveBeenCalledWith(
        expectedConfigPath,
        JSON.stringify(
          {
            mcpServers: {
              posthog: mockServerConfig,
            },
          },
          null,
          2,
        ),
        'utf8',
      );
    });

    it('should merge with existing config when config file exists', async () => {
      existsSyncMock.mockReturnValue(true);
      const existingConfig = {
        mcpServers: {
          existingServer: {
            command: 'existing',
            args: [],
            env: {},
          },
        },
      };
      readFileMock.mockResolvedValue(JSON.stringify(existingConfig));
      mergeMock.mockReturnValue({
        mcpServers: {
          existingServer: existingConfig.mcpServers.existingServer,
          posthog: mockServerConfig,
        },
      });

      await client.addServer(mockApiKey);

      expect(mergeMock).toHaveBeenCalledWith({}, existingConfig, {
        mcpServers: { posthog: mockServerConfig },
      });
      expect(writeFileMock).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify(
          {
            mcpServers: {
              existingServer: existingConfig.mcpServers.existingServer,
              posthog: mockServerConfig,
            },
          },
          null,
          2,
        ),
        'utf8',
      );
    });

    it('should create new config when existing config is invalid', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue('invalid json');
      mergeMock.mockReturnValue({
        mcpServers: {
          posthog: mockServerConfig,
        },
      });

      await client.addServer(mockApiKey);

      expect(mergeMock).toHaveBeenCalledWith(
        {},
        { mcpServers: {} },
        { mcpServers: { posthog: mockServerConfig } },
      );
      expect(writeFileMock).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify(
          {
            mcpServers: {
              posthog: mockServerConfig,
            },
          },
          null,
          2,
        ),
        'utf8',
      );
    });

    it('should handle mkdir failure gracefully', async () => {
      existsSyncMock.mockReturnValue(false);
      mkdirMock.mockRejectedValue(new Error('Permission denied'));

      await expect(client.addServer(mockApiKey)).rejects.toThrow(
        'Permission denied',
      );
      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('should handle writeFile failure gracefully', async () => {
      existsSyncMock.mockReturnValue(false);
      mkdirMock.mockResolvedValue(undefined); // Reset mkdir to succeed
      mergeMock.mockReturnValue({ mcpServers: { posthog: mockServerConfig } });
      writeFileMock.mockRejectedValue(new Error('Disk full'));

      await expect(client.addServer(mockApiKey)).rejects.toThrow('Disk full');
    });

    it('should call getDefaultServerConfig with the provided API key', async () => {
      existsSyncMock.mockReturnValue(false);
      mergeMock.mockReturnValue({ mcpServers: { posthog: mockServerConfig } });

      await client.addServer(mockApiKey);

      expect(getDefaultServerConfigMock).toHaveBeenCalledWith(mockApiKey);
      expect(getDefaultServerConfigMock).toHaveBeenCalledTimes(1);
    });

    it('should overwrite existing posthog server configuration', async () => {
      existsSyncMock.mockReturnValue(true);
      const existingConfig = {
        mcpServers: {
          posthog: {
            command: 'old-command',
            args: ['old-args'],
            env: { OLD_ENV: 'old-value' },
          },
          otherServer: mockServerConfig,
        },
      };
      readFileMock.mockResolvedValue(JSON.stringify(existingConfig));
      mergeMock.mockReturnValue({
        mcpServers: {
          posthog: mockServerConfig,
          otherServer: mockServerConfig,
        },
      });

      await client.addServer(mockApiKey);

      expect(mergeMock).toHaveBeenCalledWith({}, existingConfig, {
        mcpServers: { posthog: mockServerConfig },
      });
    });
  });

  describe('removeServer', () => {
    it('should do nothing when config file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.removeServer();

      expect(readFileMock).not.toHaveBeenCalled();
      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('should remove posthog server from config', async () => {
      existsSyncMock.mockReturnValue(true);
      const configWithPosthog = {
        mcpServers: {
          posthog: mockServerConfig,
          otherServer: {
            command: 'other',
            args: [],
            env: {},
          },
        },
      };
      readFileMock.mockResolvedValue(JSON.stringify(configWithPosthog));

      await client.removeServer();

      expect(writeFileMock).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify(
          {
            mcpServers: {
              otherServer: configWithPosthog.mcpServers.otherServer,
            },
          },
          null,
          2,
        ),
        'utf8',
      );
    });

    it('should handle config with only posthog server', async () => {
      existsSyncMock.mockReturnValue(true);
      const configWithOnlyPosthog = {
        mcpServers: {
          posthog: mockServerConfig,
        },
      };
      readFileMock.mockResolvedValue(JSON.stringify(configWithOnlyPosthog));

      await client.removeServer();

      expect(writeFileMock).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify(
          {
            mcpServers: {},
          },
          null,
          2,
        ),
        'utf8',
      );
    });

    it('should do nothing when posthog server is not in config', async () => {
      existsSyncMock.mockReturnValue(true);
      const configWithoutPosthog = {
        mcpServers: {
          otherServer: {
            command: 'other',
            args: [],
            env: {},
          },
        },
      };
      readFileMock.mockResolvedValue(JSON.stringify(configWithoutPosthog));

      await client.removeServer();

      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('should handle config with empty mcpServers', async () => {
      existsSyncMock.mockReturnValue(true);
      const configWithEmptyServers = {
        mcpServers: {},
      };
      readFileMock.mockResolvedValue(JSON.stringify(configWithEmptyServers));

      await client.removeServer();

      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue('invalid json');

      await client.removeServer();

      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('should handle file read errors gracefully', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockRejectedValue(new Error('File read error'));

      await client.removeServer();

      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('should handle Zod parsing errors gracefully', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(JSON.stringify({ valid: 'json' }));

      const { DefaultMCPClientConfig } = require('../../defaults');
      DefaultMCPClientConfig.parse.mockImplementation(() => {
        throw new Error('Zod validation error');
      });

      await client.removeServer();

      expect(writeFileMock).not.toHaveBeenCalled();
    });

    it('should handle writeFile errors gracefully', async () => {
      existsSyncMock.mockReturnValue(true);
      const configWithPosthog = {
        mcpServers: {
          posthog: mockServerConfig,
        },
      };
      readFileMock.mockResolvedValue(JSON.stringify(configWithPosthog));
      writeFileMock.mockRejectedValue(new Error('Disk full'));

      await expect(client.removeServer()).rejects.toThrow('Disk full');
    });

    it('should handle config without mcpServers property', async () => {
      existsSyncMock.mockReturnValue(true);
      const configWithoutMcpServers = {};
      readFileMock.mockResolvedValue(JSON.stringify(configWithoutMcpServers));

      await client.removeServer();

      expect(writeFileMock).not.toHaveBeenCalled();
    });
  });
});
