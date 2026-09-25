import { DefaultMCPClient } from '@steps/add-mcp-server-to-clients/MCPClient';
import * as fs from 'fs';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

const CONFIG_PATH = '/home/test/.some-editor/mcp.json';

class TestClient extends DefaultMCPClient {
  name = 'Test Editor';
  getConfigPath(): Promise<string> {
    return Promise.resolve(CONFIG_PATH);
  }
  isClientSupported(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

describe('DefaultMCPClient — addServer', () => {
  const existsSyncMock = fs.existsSync as Mock;
  const readFileMock = fs.promises.readFile as Mock;
  const writeFileMock = fs.promises.writeFile as Mock;

  const serverConfigFor = () =>
    new TestClient().getServerConfig(undefined, ['flags'], false);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('installs into a config that has no posthog entry yet', async () => {
    existsSyncMock.mockReturnValue(false);

    await expect(
      new TestClient().addServer(undefined, ['flags']),
    ).resolves.toEqual({ success: true });
    expect(writeFileMock).toHaveBeenCalled();
  });

  it('reports already-installed and leaves the file alone when the entry is identical', async () => {
    existsSyncMock.mockReturnValue(true);
    readFileMock.mockResolvedValue(
      JSON.stringify({ mcpServers: { posthog: serverConfigFor() } }),
    );

    await expect(
      new TestClient().addServer(undefined, ['flags'], false),
    ).resolves.toEqual({ success: true, alreadyInstalled: true });
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('rewrites the entry when the existing config differs', async () => {
    existsSyncMock.mockReturnValue(true);
    readFileMock.mockResolvedValue(
      JSON.stringify({ mcpServers: { posthog: { command: 'stale' } } }),
    );

    await expect(
      new TestClient().addServer(undefined, ['flags'], false),
    ).resolves.toEqual({ success: true });
    expect(writeFileMock).toHaveBeenCalled();
  });

  it('returns the underlying error as the failure reason', async () => {
    existsSyncMock.mockReturnValue(true);
    readFileMock.mockRejectedValue(new Error('EACCES: permission denied'));

    await expect(
      new TestClient().addServer(undefined, ['flags']),
    ).resolves.toEqual({ success: false, reason: 'EACCES: permission denied' });
  });
});
