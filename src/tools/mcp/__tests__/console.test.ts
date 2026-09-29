const { mockGetSupportedClientsConsole, mockAddMCPServerConsole } = vi.hoisted(
  () => ({
    mockGetSupportedClientsConsole: vi.fn(),
    mockAddMCPServerConsole: vi.fn(),
  }),
);

vi.mock(import('@shared/mcp-clients/install'), () => ({
  getSupportedClients: mockGetSupportedClientsConsole,
  addMCPServer: mockAddMCPServerConsole,
  getInstalledClients: vi.fn(),
  removeMCPServer: vi.fn(),
}));
vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  } as never,
}));

import { McpClientStatus } from '@shared/mcp-clients/results';
import { analytics } from '@utils/analytics';
import { addMcpServer } from '../console';

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  step: vi.fn(),
};
const client = (name: string) => ({ name });

// A scripted install has no screen to read: the code is the only outcome it sees.
describe('addMcpServer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves 0 once every detected client has the server', async () => {
    mockGetSupportedClientsConsole.mockResolvedValue([
      client('Cursor'),
      client('Zed'),
    ]);
    mockAddMCPServerConsole.mockResolvedValue([
      { name: 'Cursor', status: McpClientStatus.Changed },
      { name: 'Zed', status: McpClientStatus.Unchanged },
    ]);
    await expect(addMcpServer({}, { log })).resolves.toBe(0);
    expect(analytics.flush).toHaveBeenCalled();
  });

  it('resolves 1 when any client fails, even if another succeeds', async () => {
    mockGetSupportedClientsConsole.mockResolvedValue([
      client('Cursor'),
      client('Zed'),
    ]);
    mockAddMCPServerConsole.mockResolvedValue([
      { name: 'Cursor', status: McpClientStatus.Changed },
      { name: 'Zed', status: McpClientStatus.Failed, detail: 'no config' },
    ]);
    await expect(addMcpServer({}, { log })).resolves.toBe(1);
  });

  it('resolves 1 when no client is detected', async () => {
    mockGetSupportedClientsConsole.mockResolvedValue([]);
    await expect(addMcpServer({}, { log })).resolves.toBe(1);
    expect(mockAddMCPServerConsole).not.toHaveBeenCalled();
  });
});
