import { createMcpInstaller } from '@ui/tui/services/mcp-installer';
import * as mcpModuleReal from '@steps/add-mcp-server-to-clients/index';
import { analytics } from '@utils/analytics';

// The module is mocked below. Expose its exports as plain Mocks so the tests
// can drive them with lightweight partial fixtures (the same loose access the
// previous `require()` form gave) while still typing the .mock* helpers.
const mcpModule = mcpModuleReal as unknown as Record<string, Mock>;

vi.mock('../../../steps/add-mcp-server-to-clients/index.js', () => ({
  getSupportedClients: vi.fn(),
  getInstalledClients: vi.fn(),
  removeMCPServer: vi.fn(),
  getSupportedPluginClients: vi.fn(),
  installPlugins: vi.fn(),
}));

vi.mock('../../../steps/add-mcp-server-to-clients/defaults.js', () => ({
  ALL_FEATURE_VALUES: ['feature-a'],
}));

vi.mock('../../../utils/debug.js', () => ({
  logToFile: vi.fn(),
}));

vi.mock('../../../utils/analytics.js', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

describe('createMcpInstaller — installPlugins', () => {
  const mockClaudeClient = { name: 'Claude Code' };
  const mockCursorClient = { name: 'Cursor' };

  beforeEach(() => {
    vi.clearAllMocks();
    mcpModule.getSupportedClients.mockResolvedValue([
      mockClaudeClient,
      mockCursorClient,
    ]);
  });

  it('calls installPlugins on plugin-capable clients and returns installed names', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([mockClaudeClient]);
    mcpModule.installPlugins.mockResolvedValue({
      installed: ['Claude Code'],
      hints: [],
    });

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code', 'Cursor']);

    expect(mcpModule.getSupportedPluginClients).toHaveBeenCalledWith([
      mockClaudeClient,
      mockCursorClient,
    ]);
    expect(mcpModule.installPlugins).toHaveBeenCalledWith([mockClaudeClient]);
    expect(result).toEqual({ installed: ['Claude Code'], hints: [] });
  });

  it('emits mcp plugins installed analytics with clients and attempted', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([mockClaudeClient]);
    mcpModule.installPlugins.mockResolvedValue({
      installed: ['Claude Code'],
      hints: [],
    });

    const installer = createMcpInstaller();
    await installer.detectClients();
    await installer.installPlugins(['Claude Code']);

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'mcp plugins installed',
      {
        clients: ['Claude Code'],
        attempted: ['Claude Code'],
        not_installed: [],
      },
    );
  });

  it('returns empty array and still emits analytics when no clients support plugins', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([]);
    mcpModule.installPlugins.mockResolvedValue({ installed: [], hints: [] });

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code']);

    expect(result).toEqual({ installed: [], hints: [] });
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'mcp plugins installed',
      {
        clients: [],
        attempted: [],
        not_installed: [],
      },
    );
  });

  it('only passes clients matching the requested names to getSupportedPluginClients', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([]);
    mcpModule.installPlugins.mockResolvedValue({ installed: [], hints: [] });

    const installer = createMcpInstaller();
    await installer.detectClients();
    await installer.installPlugins(['Claude Code']); // Cursor excluded

    expect(mcpModule.getSupportedPluginClients).toHaveBeenCalledWith([
      mockClaudeClient,
    ]);
  });

  it('returns partial success and surfaces a hint when plugin install fails for some clients', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([
      mockClaudeClient,
      mockCursorClient,
    ]);
    mcpModule.installPlugins.mockResolvedValue({
      installed: ['Claude Code'],
      hints: [{ client: 'Cursor', message: 'update the CLI and retry' }],
    });

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code', 'Cursor']);

    expect(result).toEqual({
      installed: ['Claude Code'],
      hints: [{ client: 'Cursor', message: 'update the CLI and retry' }],
    });
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'mcp plugins installed',
      {
        clients: ['Claude Code'],
        attempted: ['Claude Code', 'Cursor'],
        not_installed: ['Cursor'],
      },
    );
  });
});

describe('createMcpInstaller — detectClients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
