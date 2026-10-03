const {
  mockGetSupportedClientsConsole,
  mockAddMCPServerConsole,
  mockGetInstalledClientsConsole,
  mockRemoveMCPServerConsole,
} = vi.hoisted(() => ({
  mockGetSupportedClientsConsole: vi.fn(),
  mockAddMCPServerConsole: vi.fn(),
  mockGetInstalledClientsConsole: vi.fn(),
  mockRemoveMCPServerConsole: vi.fn(),
}));

vi.mock(import('@shared/mcp-clients/install'), () => ({
  getSupportedClients: mockGetSupportedClientsConsole,
  addMCPServer: mockAddMCPServerConsole,
  getInstalledClients: mockGetInstalledClientsConsole,
  removeMCPServer: mockRemoveMCPServerConsole,
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
import {
  addMCPServerToClientsStep,
  removeMCPServerFromClientsStep,
} from '../console';

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  step: vi.fn(),
};
const client = (name: string) => ({ name });

// A scripted install has no screen to read: the code is the only outcome it sees.
describe('addMCPServerToClientsStep', () => {
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
    await expect(addMCPServerToClientsStep({}, { log })).resolves.toBe(0);
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
    await expect(addMCPServerToClientsStep({}, { log })).resolves.toBe(1);
  });

  it('resolves 1 when no client is detected', async () => {
    mockGetSupportedClientsConsole.mockResolvedValue([]);
    await expect(addMCPServerToClientsStep({}, { log })).resolves.toBe(1);
    expect(mockAddMCPServerConsole).not.toHaveBeenCalled();
  });
});

// Removing nothing, or failing on one client, never fails a scripted run.
describe('removeMCPServerFromClientsStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves 0 when no client has the server', async () => {
    mockGetInstalledClientsConsole.mockResolvedValue([]);
    await expect(removeMCPServerFromClientsStep({}, { log })).resolves.toBe(0);
    expect(mockRemoveMCPServerConsole).not.toHaveBeenCalled();
  });

  it.each([McpClientStatus.Changed, McpClientStatus.Failed])(
    'resolves 0 when the client ends %s',
    async (status) => {
      mockGetInstalledClientsConsole.mockResolvedValue([client('Cursor')]);
      mockRemoveMCPServerConsole.mockResolvedValue([
        { name: 'Cursor', status },
      ]);
      await expect(removeMCPServerFromClientsStep({}, { log })).resolves.toBe(
        0,
      );
    },
  );
});
