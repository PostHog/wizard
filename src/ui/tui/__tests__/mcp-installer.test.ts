import { createMcpInstaller } from '@ui/tui/services/mcp-installer';

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
  const mcpModule = require('@steps/add-mcp-server-to-clients/index');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { analytics } = require('@utils/analytics');

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
    mcpModule.installPlugins.mockResolvedValue(['Claude Code']);

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code', 'Cursor']);

    expect(mcpModule.getSupportedPluginClients).toHaveBeenCalledWith([
      mockClaudeClient,
      mockCursorClient,
    ]);
    expect(mcpModule.installPlugins).toHaveBeenCalledWith([mockClaudeClient]);
    expect(result).toEqual(['Claude Code']);
  });

  it('emits mcp plugins installed analytics with clients and attempted', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([mockClaudeClient]);
    mcpModule.installPlugins.mockResolvedValue(['Claude Code']);

    const installer = createMcpInstaller();
    await installer.detectClients();
    await installer.installPlugins(['Claude Code']);

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'mcp plugins installed',
      {
        clients: ['Claude Code'],
        attempted: ['Claude Code'],
      },
    );
  });

  it('returns empty array and still emits analytics when no clients support plugins', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([]);
    mcpModule.installPlugins.mockResolvedValue([]);

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code']);

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
    mcpModule.installPlugins.mockResolvedValue(['Claude Code']); // Cursor failed

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code', 'Cursor']);

    expect(result).toEqual(['Claude Code']);
  });
});

describe('createMcpInstaller — detectClients', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mcpModule = require('@steps/add-mcp-server-to-clients/index');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('surfaces the finish note for browser-finishable clients only', async () => {
    mcpModule.getSupportedClients.mockResolvedValue([
      { name: 'Cursor' },
      {
        name: 'Claude Desktop/Web',
        connectorUrl: 'https://claude.ai/directory/connectors/posthog',
        finishInstruction: 'Sign in and click "Connect" to finish.',
      },
    ]);

    const installer = createMcpInstaller();
    const detected = await installer.detectClients();

    expect(detected).toEqual([
      { name: 'Cursor', supportsPlugin: false, finish: undefined },
      {
        name: 'Claude Desktop/Web',
        supportsPlugin: false,
        finish: {
          url: 'https://claude.ai/directory/connectors/posthog',
          instruction: 'Sign in and click "Connect" to finish.',
        },
      },
    ]);
  });
});
