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

  const mockCodexClient = { name: 'Codex' };
  const mockCursorClient = { name: 'Cursor' };

  beforeEach(() => {
    jest.clearAllMocks();
    mcpModule.getSupportedClients.mockResolvedValue([
      mockCodexClient,
      mockCursorClient,
    ]);
  });

  it('calls installPlugins on plugin-capable clients and returns installed names', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([mockCodexClient]);
    mcpModule.installPlugins.mockResolvedValue(['Codex']);

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Codex', 'Cursor']);

    expect(mcpModule.getSupportedPluginClients).toHaveBeenCalledWith([
      mockCodexClient,
      mockCursorClient,
    ]);
    expect(mcpModule.installPlugins).toHaveBeenCalledWith([mockCodexClient]);
    expect(result).toEqual(['Codex']);
  });

  it('emits mcp plugins installed analytics with clients and attempted', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([mockCodexClient]);
    mcpModule.installPlugins.mockResolvedValue(['Codex']);

    const installer = createMcpInstaller();
    await installer.detectClients();
    await installer.installPlugins(['Codex']);

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'mcp plugins installed',
      {
        clients: ['Codex'],
        attempted: ['Codex'],
      },
    );
  });

  it('returns empty array and still emits analytics when no clients support plugins', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([]);
    mcpModule.installPlugins.mockResolvedValue([]);

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Codex']);

    expect(result).toEqual([]);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'mcp plugins installed',
      {
        clients: [],
        attempted: [],
      },
    );
  });

  it('only passes clients matching the requested names to getSupportedPluginClients', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([]);
    mcpModule.installPlugins.mockResolvedValue([]);

    const installer = createMcpInstaller();
    await installer.detectClients();
    await installer.installPlugins(['Codex']); // Cursor excluded

    expect(mcpModule.getSupportedPluginClients).toHaveBeenCalledWith([
      mockCodexClient,
    ]);
  });

  it('returns partial success when plugin install fails for some clients', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([
      mockCodexClient,
      mockCursorClient,
    ]);
    mcpModule.installPlugins.mockResolvedValue(['Codex']); // Cursor failed

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Codex', 'Cursor']);

    expect(result).toEqual(['Codex']);
  });
});
