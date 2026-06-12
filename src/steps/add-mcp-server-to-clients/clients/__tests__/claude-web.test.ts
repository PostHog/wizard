import { ClaudeWebMCPClient } from '@steps/add-mcp-server-to-clients/clients/claude-web';
import { isBrowserFinishable } from '@steps/add-mcp-server-to-clients/browser-client';
import { openTrackedLink } from '@utils/links';

jest.mock('@utils/links', () => ({
  openTrackedLink: jest.fn(),
}));

const openTrackedLinkMock = openTrackedLink as jest.Mock;

const CONNECTOR_URL = 'https://claude.ai/directory/connectors/posthog';

describe('ClaudeWebMCPClient', () => {
  let client: ClaudeWebMCPClient;

  beforeEach(() => {
    client = new ClaudeWebMCPClient();
    jest.clearAllMocks();
  });

  it('has the expected name and connector metadata', () => {
    expect(client.name).toBe('Claude Desktop/Web');
    expect(client.connectorUrl).toBe(CONNECTOR_URL);
    expect(client.finishInstruction).toBe(
      'Sign in and click "Connect" to finish.',
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

  it('opens the connector page as a tracked link on addServer', async () => {
    await expect(client.addServer()).resolves.toEqual({ success: true });
    expect(openTrackedLinkMock).toHaveBeenCalledWith(
      CONNECTOR_URL,
      'claude-web-connector',
      { auto: true, utm: false },
    );
  });

  it('removeServer is a no-op that reports nothing removed', async () => {
    await expect(client.removeServer()).resolves.toEqual({ success: false });
    expect(openTrackedLinkMock).not.toHaveBeenCalled();
  });
});
