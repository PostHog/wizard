import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CopilotCLIMCPClient } from '../copilot-cli';
import { buildMCPUrl } from '../../defaults';

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
}));

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
  buildMCPUrl: jest.fn(),
}));

describe('CopilotCLIMCPClient', () => {
  let client: CopilotCLIMCPClient;
  const mockHomeDir = '/mock/home';
  const mockApiKey = 'test-api-key';
  const mockServerConfig = {
    type: 'http',
    url: 'https://mcp.posthog.com/mcp',
    headers: { Authorization: `Bearer ${mockApiKey}` },
  };

  const { execSync } = require('node:child_process');
  const execSyncMock = execSync as jest.Mock;

  const mkdirMock = fs.promises.mkdir as jest.Mock;
  const readFileMock = fs.promises.readFile as jest.Mock;
  const writeFileMock = fs.promises.writeFile as jest.Mock;
  const existsSyncMock = fs.existsSync as jest.Mock;
  const homedirMock = os.homedir as jest.Mock;
  const buildMCPUrlMock = buildMCPUrl as jest.Mock;

  const originalPlatform = process.platform;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    client = new CopilotCLIMCPClient();
    jest.clearAllMocks();
    homedirMock.mockReturnValue(mockHomeDir);
    buildMCPUrlMock.mockReturnValue('https://mcp.posthog.com/mcp');

    const { DefaultMCPClientConfig } = require('../../defaults');
    DefaultMCPClientConfig.parse.mockImplementation((data: any) => data);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
    });

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  });

  describe('constructor', () => {
    it('should set the correct name', () => {
      expect(client.name).toBe('Copilot CLI');
    });
  });

  describe('isClientSupported', () => {
    it('should return true when copilot binary is available', async () => {
      execSyncMock.mockReturnValue(undefined);

      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(execSyncMock).toHaveBeenCalledWith('copilot --version', {
        stdio: 'ignore',
      });
    });

    it('should return false when copilot binary is missing', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });

      await expect(client.isClientSupported()).resolves.toBe(false);
    });
  });

  describe('getConfigPath', () => {
    it('should return correct path for macOS', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const configPath = await client.getConfigPath();
      expect(configPath).toBe(
        path.join(mockHomeDir, '.copilot', 'mcp-config.json'),
      );
    });

    it('should return correct path for Linux', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });

      const configPath = await client.getConfigPath();
      expect(configPath).toBe(
        path.join(mockHomeDir, '.copilot', 'mcp-config.json'),
      );
    });

    it('should return correct path for Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });

      const mockUserProfile = 'C:\\Users\\Test';
      process.env.USERPROFILE = mockUserProfile;

      const configPath = await client.getConfigPath();
      expect(configPath).toBe(
        path.join(mockUserProfile, '.copilot', 'mcp-config.json'),
      );
    });

    it('should fall back to homedir on Windows when USERPROFILE is unset', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });
      delete process.env.USERPROFILE;

      const configPath = await client.getConfigPath();
      expect(configPath).toBe(
        path.join(mockHomeDir, '.copilot', 'mcp-config.json'),
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
        '.copilot',
        'mcp-config.json',
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

    it('should not overwrite existing config when it is invalid', async () => {
      existsSyncMock.mockReturnValue(true);
      readFileMock.mockResolvedValue(
        JSON.stringify({
          invalidKey: {
            existingServer: {
              command: 'existing',
              args: [],
              env: {},
            },
          },
          x: 'y',
        }),
      );

      await client.addServer(mockApiKey);

      expect(writeFileMock).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify(
          {
            invalidKey: {
              existingServer: {
                command: 'existing',
                args: [],
                env: {},
              },
            },
            x: 'y',
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

    it('should call buildMCPUrl with the correct transport type', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer(mockApiKey);

      expect(buildMCPUrlMock).toHaveBeenCalledWith(
        'streamable-http',
        undefined,
        undefined,
      );
    });

    it('should call buildMCPUrl with undefined API key for OAuth mode', async () => {
      existsSyncMock.mockReturnValue(false);

      await client.addServer(undefined);

      expect(buildMCPUrlMock).toHaveBeenCalledWith(
        'streamable-http',
        undefined,
        undefined,
      );

      const expectedConfigPath = path.join(
        mockHomeDir,
        '.copilot',
        'mcp-config.json',
      );
      expect(writeFileMock).toHaveBeenCalledWith(
        expectedConfigPath,
        JSON.stringify(
          {
            mcpServers: {
              posthog: {
                type: 'http',
                url: 'https://mcp.posthog.com/mcp',
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      );
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
