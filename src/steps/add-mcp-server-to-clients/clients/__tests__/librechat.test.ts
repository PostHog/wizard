import { LibreChatMCPClient } from '@steps/add-mcp-server-to-clients/clients/librechat';
import { isBrowserFinishable } from '@steps/add-mcp-server-to-clients/browser-client';
import { openTrackedLink } from '@utils/links';

vi.mock('@utils/links', () => ({
  openTrackedLink: vi.fn(),
}));

const openTrackedLinkMock = openTrackedLink as Mock;

const CONNECTOR_URL = 'https://www.librechat.ai/docs/features/mcp';

describe('LibreChatMCPClient', () => {
  let client: LibreChatMCPClient;

  beforeEach(() => {
    client = new LibreChatMCPClient();
    vi.clearAllMocks();
  });

  it('has the expected name and connector metadata', () => {
    expect(client.name).toBe('LibreChat');
    expect(client.connectorUrl).toBe(CONNECTOR_URL);
    expect(client.finishInstruction).toBe(
      'In LibreChat → MCP Settings, add a streamable-http server with URL https://mcp.posthog.com/mcp.',
    );
  });

  it('is recognised as a browser-finishable client', () => {
    expect(isBrowserFinishable(client)).toBe(true);
  });

  it('is supported on every platform', async () => {
    await expect(client.isClientSupported()).resolves.toBe(true);
  });

  it('never reports the server as locally installed', async () => {
    await expect(client.isServerInstalled()).resolves.toBe(false);
  });

  it('opens the MCP docs page as a tracked link on addServer', async () => {
    await expect(client.addServer()).resolves.toEqual({ success: true });
    expect(openTrackedLinkMock).toHaveBeenCalledWith(
      CONNECTOR_URL,
      'librechat-connector',
      { auto: true, skipUtm: true },
    );
  });

  it('removeServer is a no-op that reports nothing removed', async () => {
    await expect(client.removeServer()).resolves.toEqual({ success: false });
    expect(openTrackedLinkMock).not.toHaveBeenCalled();
  });
});
