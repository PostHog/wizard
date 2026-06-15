import opn from 'opn';
import { ClaudeWebMCPClient } from '@steps/add-mcp-server-to-clients/clients/claude-web';
import { isBrowserFinishable } from '@steps/add-mcp-server-to-clients/browser-client';

vi.mock('opn', () => ({ default: vi.fn(() => Promise.resolve()) }));

const opnMock = opn as unknown as Mock;

const CONNECTOR_URL = 'https://claude.ai/directory/connectors/posthog';

describe('ClaudeWebMCPClient', () => {
  let client: ClaudeWebMCPClient;

  beforeEach(() => {
    client = new ClaudeWebMCPClient();
    vi.clearAllMocks();
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

  it('opens the connector page on addServer and reports success', async () => {
    await expect(client.addServer()).resolves.toEqual({ success: true });
    expect(opnMock).toHaveBeenCalledWith(CONNECTOR_URL, { wait: false });
  });

  it('still reports success when opening the browser fails', async () => {
    opnMock.mockReturnValueOnce(Promise.reject(new Error('no browser')));
    await expect(client.addServer()).resolves.toEqual({ success: true });
  });

  it('removeServer is a no-op that reports nothing removed', async () => {
    await expect(client.removeServer()).resolves.toEqual({ success: false });
    expect(opnMock).not.toHaveBeenCalled();
  });
});
