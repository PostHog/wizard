import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ClaudeMCPClient } from '../claude';
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

describe('ClaudeMCPClient', () => {
  let client: ClaudeMCPClient;
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

  const originalPlatform = process.platform;

  beforeEach(() => {
    client = new ClaudeMCPClient();
    jest.clearAllMocks();
    homedirMock.mockReturnValue(mockHomeDir);
    getDefaultServerConfigMock.mockReturnValue(mockServerConfig);

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
      expect(client.name).toBe('Claude Desktop');
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
    it('should return correct path for macOS', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const configPath = (client as any).getConfigPath();
      expect(configPath).toBe(
        path.join(
          mockHomeDir,
          'Library',
          'Application Support',
          'Claude',
          'claude_desktop_config.json',
        ),
      );
    });

    it('should return correct path for Windows', () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });

      const mockAppData = 'C:\\Users\\Test\\AppData\\Roaming';
      process.env.APPDATA = mockAppData;

      const configPath = (client as any).getConfigPath();
      expect(configPath).toBe(
        path.join(mockAppData, 'Claude', 'claude_desktop_config.json'),
      );
    });

    it('should throw error for unsupported platform', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });

      expect(() => (client as any).getConfigPath()).toThrow(
        'Unsupported platform: linux',
      );
    });
  });

  describe('isServerInstalled', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
    });

    it('should return false when config file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);

      const result = await client.isServerInstalled();
      expect(result).toBe(false);
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

    it('should return false when config file is invalid JSON', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue('invalid json');

      const result = await client.isServerInstalled();
      expect(result).toBe(false);
    });

    it('should return false when readFile throws an error', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockRejectedValue(new Error('File read error'));

      const result = await client.isServerInstalled();
      expect(result).toBe(false);
    });
  });

  describe('addServer', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
    });

    it('should create config directory and add server when config file does not exist', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer(mockApiKey);

      const expectedConfigPath = path.join(
        mockHomeDir,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      );
      const expectedConfigDir = path.dirname(expectedConfigPath);

      expect(mkdirMock).toHaveBeenCalledWith(expectedConfigDir, {
        recursive: true,
      });
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

      await client.addServer(mockApiKey);

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

      await client.addServer(mockApiKey);

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

    it('should call getDefaultServerConfig with the provided API key', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer(mockApiKey);

      expect(getDefaultServerConfigMock).toHaveBeenCalledWith(mockApiKey);
    });
  });

  describe('removeServer', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
    });

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
  });
});
