import { ChatGptWebMCPClient } from '@shared/mcp-clients/clients/chatgpt-web';
import { isBrowserFinishable } from '@shared/mcp-clients/browser-client';
import { openTrackedLink } from '@utils/links';

vi.mock('@utils/links', () => ({
  openTrackedLink: vi.fn(),
}));

const openTrackedLinkMock = openTrackedLink as Mock;

const PLUGIN_URL =
  'https://chatgpt.com/plugins/plugin_asdk_app_699caef2d680819188727b0ddbb349dd';

describe('ChatGptWebMCPClient', () => {
  let client: ChatGptWebMCPClient;

  beforeEach(() => {
    client = new ChatGptWebMCPClient();
    vi.clearAllMocks();
  });

  it('has the expected name and plugin listing', () => {
    expect(client.name).toBe('ChatGPT');
    expect(client.connectorUrl).toBe(PLUGIN_URL);
    expect(client.finishInstruction).toBe(
      'Press + to install, then connect PostHog when asked.',
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

  it('opens the plugin listing as a tracked link on addServer', async () => {
    await expect(client.addServer()).resolves.toEqual({ success: true });
    expect(openTrackedLinkMock).toHaveBeenCalledWith(
      PLUGIN_URL,
      'chatgpt-plugin',
      { auto: true, skipUtm: true },
    );
  });

  it('removeServer reports a failure that says where the plugin lives', async () => {
    const result = await client.removeServer();
    expect(result.success).toBe(false);
    expect(result.reason).toContain('ChatGPT');
    expect(openTrackedLinkMock).not.toHaveBeenCalled();
  });
});
