import { createMcpInstaller } from '@tui/services/mcp-installer';
import { McpClientStatus } from '@shared/mcp-clients/results';
import * as mcpModuleReal from '@shared/mcp-clients/install';

// The module is mocked below. Expose its exports as plain Mocks so the tests
// can drive them with lightweight partial fixtures (the same loose access the
// previous `require()` form gave) while still typing the .mock* helpers.
const mcpModule = mcpModuleReal as unknown as Record<string, Mock>;

vi.mock(import('@shared/mcp-clients/install'), () => ({
  getSupportedClients: vi.fn(),
  getInstalledClients: vi.fn(),
  removeMCPServer: vi.fn(),
}));

vi.mock('@utils/debug.js', () => ({
  logToFile: vi.fn(),
}));

vi.mock('@utils/analytics.js', () => ({
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

describe('createMcpInstaller — detectInstalled and remove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists installed local clients only, passing the local flag through', async () => {
    mcpModule.getInstalledClients.mockResolvedValue([
      { name: 'Codex' },
      {
        name: 'Claude Desktop/Web',
        connectorUrl: 'https://claude.ai/directory/connectors/posthog',
        finishInstruction: 'Sign in and click "Connect" to finish.',
      },
    ]);

    const installer = createMcpInstaller();
    const installed = await installer.detectInstalled(true);

    expect(mcpModule.getInstalledClients).toHaveBeenCalledWith(true);
    expect(installed.map((c) => c.name)).toEqual(['Codex']);
  });

  it('removes only the selected clients, passing the local flag through so `mcp remove --local` targets the right server', async () => {
    mcpModule.getInstalledClients.mockResolvedValue([
      { name: 'Cursor' },
      { name: 'Codex' },
    ]);
    mcpModule.removeMCPServer.mockResolvedValue([changed('Codex')]);

    const installer = createMcpInstaller();
    await installer.detectInstalled(true);
    await installer.remove(['Codex'], true);

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
    await installer.detectInstalled();

    await expect(installer.remove(['Cursor', 'Codex'])).resolves.toEqual([
      changed('Cursor'),
      { name: 'Codex', status: McpClientStatus.Failed, detail: 'codex locked' },
    ]);
  });

  it('returns nothing when no selected client is installed', async () => {
    mcpModule.getInstalledClients.mockResolvedValue([]);

    const installer = createMcpInstaller();
    await installer.detectInstalled();

    await expect(installer.remove(['Cursor'])).resolves.toEqual([]);
    expect(mcpModule.removeMCPServer).not.toHaveBeenCalled();
  });
});

describe('createMcpInstaller — detectClients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks browser-finishable clients as account clients with a finish note', async () => {
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
      {
        name: 'Cursor',
        kind: 'local',
        supportsPlugin: false,
        finish: undefined,
        loginCommand: undefined,
      },
      {
        name: 'Claude Desktop/Web',
        kind: 'account',
        supportsPlugin: false,
        finish: {
          url: 'https://claude.ai/directory/connectors/posthog',
          instruction: 'Sign in and click "Connect" to finish.',
        },
        loginCommand: undefined,
      },
    ]);
  });
});
