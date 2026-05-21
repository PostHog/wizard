import { createMcpInstaller } from '../services/mcp-installer';

jest.mock('../../../steps/add-mcp-server-to-clients/index.js', () => ({
  getSupportedClients: jest.fn(),
  getInstalledClients: jest.fn(),
  removeMCPServer: jest.fn(),
  getSupportedPluginClients: jest.fn(),
  installPlugins: jest.fn(),
}));

jest.mock('../../../steps/add-mcp-server-to-clients/defaults.js', () => ({
  ALL_FEATURE_VALUES: ['feature-a'],
}));

jest.mock('../../../utils/debug.js', () => ({
  logToFile: jest.fn(),
}));

jest.mock('../../../utils/analytics.js', () => ({
  analytics: { wizardCapture: jest.fn() },
}));

describe('createMcpInstaller — installPlugins', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mcpModule = require('../../../steps/add-mcp-server-to-clients/index.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { analytics } = require('../../../utils/analytics.js');

  const mockClaudeClient = { name: 'Claude Code' };
  const mockCursorClient = { name: 'Cursor' };

  beforeEach(() => {
    jest.clearAllMocks();
    mcpModule.getSupportedClients.mockResolvedValue([
      mockClaudeClient,
      mockCursorClient,
    ]);
  });

  it('calls installPlugins on plugin-capable clients and returns installed names', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([mockClaudeClient]);
    mcpModule.installPlugins.mockResolvedValue({
      installed: ['Claude Code'],
      outdated: [],
    });

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code', 'Cursor']);

    expect(mcpModule.getSupportedPluginClients).toHaveBeenCalledWith([
      mockClaudeClient,
      mockCursorClient,
    ]);
    expect(mcpModule.installPlugins).toHaveBeenCalledWith([mockClaudeClient]);
    expect(result).toEqual({ installed: ['Claude Code'], outdated: [] });
  });

  it('emits mcp plugins installed analytics with clients, attempted, and outdated', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([mockClaudeClient]);
    mcpModule.installPlugins.mockResolvedValue({
      installed: ['Claude Code'],
      outdated: [],
    });

    const installer = createMcpInstaller();
    await installer.detectClients();
    await installer.installPlugins(['Claude Code']);

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'mcp plugins installed',
      {
        clients: ['Claude Code'],
        attempted: ['Claude Code'],
        outdated: [],
      },
    );
  });

  it('surfaces outdated clients in the return value and analytics', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([mockClaudeClient]);
    mcpModule.installPlugins.mockResolvedValue({
      installed: [],
      outdated: ['Claude Code'],
    });

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code']);

    expect(result).toEqual({ installed: [], outdated: ['Claude Code'] });
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'mcp plugins installed',
      {
        clients: [],
        attempted: ['Claude Code'],
        outdated: ['Claude Code'],
      },
    );
  });

  it('returns empty arrays and still emits analytics when no clients support plugins', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([]);
    mcpModule.installPlugins.mockResolvedValue({
      installed: [],
      outdated: [],
    });

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code']);

    expect(result).toEqual({ installed: [], outdated: [] });
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'mcp plugins installed',
      {
        clients: [],
        attempted: [],
        outdated: [],
      },
    );
  });

  it('only passes clients matching the requested names to getSupportedPluginClients', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([]);
    mcpModule.installPlugins.mockResolvedValue({
      installed: [],
      outdated: [],
    });

    const installer = createMcpInstaller();
    await installer.detectClients();
    await installer.installPlugins(['Claude Code']); // Cursor excluded

    expect(mcpModule.getSupportedPluginClients).toHaveBeenCalledWith([
      mockClaudeClient,
    ]);
  });

  it('returns partial success when plugin install fails for some clients', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([
      mockClaudeClient,
      mockCursorClient,
    ]);
    mcpModule.installPlugins.mockResolvedValue({
      installed: ['Claude Code'],
      outdated: [],
    }); // Cursor failed

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code', 'Cursor']);

    expect(result).toEqual({ installed: ['Claude Code'], outdated: [] });
  });
});
