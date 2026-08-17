import { createMcpInstaller } from '@ui/tui/services/mcp-installer';
import { McpClientStatus } from '@steps/add-mcp-server-to-clients/results';
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

const changed = (name: string) => ({
  name,
  status: McpClientStatus.Changed,
});
const alreadyInstalled = (name: string) => ({
  name,
  status: McpClientStatus.Unchanged,
});

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

  it('calls installPlugins on plugin-capable clients and returns their results', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([mockClaudeClient]);
    mcpModule.installPlugins.mockResolvedValue([changed('Claude Code')]);

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code', 'Cursor']);

    expect(mcpModule.getSupportedPluginClients).toHaveBeenCalledWith([
      mockClaudeClient,
      mockCursorClient,
    ]);
    expect(mcpModule.installPlugins).toHaveBeenCalledWith([mockClaudeClient]);
    expect(result).toEqual([changed('Claude Code')]);
  });

  it('emits mcp plugins installed analytics with clients and attempted', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([mockClaudeClient]);
    mcpModule.installPlugins.mockResolvedValue([changed('Claude Code')]);

    const installer = createMcpInstaller();
    await installer.detectClients();
    await installer.installPlugins(['Claude Code']);

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'mcp plugins installed',
      {
        clients: ['Claude Code'],
        already_installed: [],
        attempted: ['Claude Code'],
      },
    );
  });

  it('reports an already-installed plugin separately from a fresh install', async () => {
    mcpModule.getSupportedPluginClients.mockReturnValue([mockClaudeClient]);
    mcpModule.installPlugins.mockResolvedValue([
      alreadyInstalled('Claude Code'),
    ]);

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code']);

    expect(result).toEqual([alreadyInstalled('Claude Code')]);
    // `clients` still counts it — the client ends up with the plugin either way.
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'mcp plugins installed',
      {
        clients: ['Claude Code'],
        already_installed: ['Claude Code'],
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
        already_installed: [],
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
    mcpModule.installPlugins.mockResolvedValue([
      changed('Claude Code'),
      { name: 'Cursor', status: McpClientStatus.Failed, detail: 'boom' },
    ]);

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.installPlugins(['Claude Code', 'Cursor']);

    expect(result).toEqual([
      changed('Claude Code'),
      { name: 'Cursor', status: McpClientStatus.Failed, detail: 'boom' },
    ]);
  });
});

describe('createMcpInstaller — install', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports installed, already-installed and failed clients separately', async () => {
    mcpModule.getSupportedClients.mockResolvedValue([
      {
        name: 'Cursor',
        addServer: vi.fn().mockResolvedValue({ success: true }),
      },
      {
        name: 'Codex',
        addServer: vi
          .fn()
          .mockResolvedValue({ success: true, alreadyInstalled: true }),
      },
      {
        name: 'Zed',
        addServer: vi.fn().mockResolvedValue({
          success: false,
          reason: 'EACCES: permission denied',
        }),
      },
    ]);

    const installer = createMcpInstaller();
    await installer.detectClients();
    const result = await installer.install(['Cursor', 'Codex', 'Zed']);

    expect(result).toEqual([
      changed('Cursor'),
      alreadyInstalled('Codex'),
      {
        name: 'Zed',
        status: McpClientStatus.Failed,
        detail: 'EACCES: permission denied',
      },
    ]);
  });

  it('turns a thrown addServer into a failed result carrying the message', async () => {
    mcpModule.getSupportedClients.mockResolvedValue([
      {
        name: 'Cursor',
        addServer: vi.fn().mockRejectedValue(new Error('disk full')),
      },
    ]);

    const installer = createMcpInstaller();
    await installer.detectClients();

    await expect(installer.install(['Cursor'])).resolves.toEqual([
      { name: 'Cursor', status: McpClientStatus.Failed, detail: 'disk full' },
    ]);
  });
});

describe('createMcpInstaller — remove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the local flag through so `mcp remove --local` targets the right server', async () => {
    mcpModule.getInstalledClients.mockResolvedValue([{ name: 'Codex' }]);
    mcpModule.removeMCPServer.mockResolvedValue([changed('Codex')]);

    const installer = createMcpInstaller();
    await installer.remove(true);

    expect(mcpModule.getInstalledClients).toHaveBeenCalledWith(true);
    expect(mcpModule.removeMCPServer).toHaveBeenCalledWith(
      [{ name: 'Codex' }],
      true,
    );
  });

  it('returns per-client removal results instead of assuming success', async () => {
    mcpModule.getInstalledClients.mockResolvedValue([
      { name: 'Cursor' },
      { name: 'Codex' },
    ]);
    mcpModule.removeMCPServer.mockResolvedValue([
      changed('Cursor'),
      { name: 'Codex', status: McpClientStatus.Failed, detail: 'codex locked' },
    ]);

    const installer = createMcpInstaller();

    await expect(installer.remove()).resolves.toEqual([
      changed('Cursor'),
      { name: 'Codex', status: McpClientStatus.Failed, detail: 'codex locked' },
    ]);
  });

  it('returns nothing when no client has the server installed', async () => {
    mcpModule.getInstalledClients.mockResolvedValue([]);

    const installer = createMcpInstaller();

    await expect(installer.remove()).resolves.toEqual([]);
    expect(mcpModule.removeMCPServer).not.toHaveBeenCalled();
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
