import { ClaudeCodeMCPClient } from '@steps/add-mcp-server-to-clients/clients/claude-code';
import { execSync } from 'child_process';
import { analytics } from '@utils/analytics';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../../utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

vi.mock('../../../../utils/debug', () => ({
  debug: vi.fn(),
}));

describe('ClaudeCodeMCPClient — addServer', () => {
  const execSyncMock = execSync as Mock;
  const BASE_URL = 'https://mcp.posthog.com/mcp';

  beforeEach(() => {
    vi.clearAllMocks();
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'command -v claude') return Buffer.from('');
      return Buffer.from('');
    });
  });

  const callsMatching = (fragment: string) =>
    execSyncMock.mock.calls.filter((c) => String(c[0]).includes(fragment));

  it('adds the server without any credentials in the command', async () => {
    const client = new ClaudeCodeMCPClient();
    await expect(client.addServer(['workflows'])).resolves.toEqual({
      success: true,
    });
    const addCall = callsMatching('mcp" "add')[0]!;
    expect(String(addCall[0])).toContain(`${BASE_URL}?features=workflows`);
    expect(String(addCall[0])).not.toContain('Authorization');
  });

  it('leaves an existing entry alone when it already points at the same URL', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      const c = String(cmd);
      if (c.includes('mcp" "add')) throw new Error('already exists');
      if (c.includes('mcp get')) return Buffer.from(`  URL: ${BASE_URL}\n`);
      return Buffer.from('');
    });
    const client = new ClaudeCodeMCPClient();
    await expect(client.addServer()).resolves.toEqual({
      success: true,
      alreadyInstalled: true,
    });
    expect(callsMatching('mcp remove')).toHaveLength(0);
  });

  it('replaces the entry when it exists with a different URL', async () => {
    let adds = 0;
    execSyncMock.mockImplementation((cmd: string) => {
      const c = String(cmd);
      if (c.includes('mcp" "add')) {
        adds += 1;
        if (adds === 1) throw new Error('already exists');
        return Buffer.from('');
      }
      if (c.includes('mcp get'))
        return Buffer.from(`  URL: ${BASE_URL}?features=flags\n`);
      return Buffer.from('');
    });
    const client = new ClaudeCodeMCPClient();
    await expect(client.addServer(['workflows'])).resolves.toEqual({
      success: true,
    });
    expect(callsMatching('mcp remove')).toHaveLength(1);
    expect(adds).toBe(2);
  });

  it('replaces the entry when the existing URL cannot be determined', async () => {
    let adds = 0;
    execSyncMock.mockImplementation((cmd: string) => {
      const c = String(cmd);
      if (c.includes('mcp" "add')) {
        adds += 1;
        if (adds === 1) throw new Error('already exists');
        return Buffer.from('');
      }
      if (c.includes('mcp get')) throw new Error('unknown command');
      return Buffer.from('');
    });
    const client = new ClaudeCodeMCPClient();
    await expect(client.addServer(['workflows'])).resolves.toEqual({
      success: true,
    });
    expect(callsMatching('mcp remove')).toHaveLength(1);
  });

  it('treats a same-set, different-order selection as identical (no remove)', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      const c = String(cmd);
      if (c.includes('mcp" "add')) throw new Error('already exists');
      if (c.includes('mcp get'))
        return Buffer.from(`  URL: ${BASE_URL}?features=dashboards,insights\n`);
      return Buffer.from('');
    });
    const client = new ClaudeCodeMCPClient();
    await expect(client.addServer(['insights', 'dashboards'])).resolves.toEqual(
      { success: true, alreadyInstalled: true },
    );
    expect(callsMatching('mcp remove')).toHaveLength(0);
  });

  it('restores the previous entry when the replacement re-add fails', async () => {
    let adds = 0;
    execSyncMock.mockImplementation((cmd: string) => {
      const c = String(cmd);
      if (c.includes('mcp" "add')) {
        adds += 1;
        if (adds === 1) throw new Error('already exists');
        if (c.includes('features=workflows')) throw new Error('add blew up');
        return Buffer.from('');
      }
      if (c.includes('mcp get'))
        return Buffer.from(`  URL: ${BASE_URL}?features=flags\n`);
      return Buffer.from('');
    });
    const client = new ClaudeCodeMCPClient();
    await expect(client.addServer(['workflows'])).resolves.toEqual({
      success: false,
      reason: 'add blew up',
    });
    const restore = callsMatching('mcp" "add').filter((c) =>
      String(c[0]).includes('features=flags'),
    );
    expect(restore).toHaveLength(1);
  });

  it('reports a failed replacement with its reason', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      const c = String(cmd);
      if (c.includes('mcp" "add')) throw new Error('already exists');
      if (c.includes('mcp get'))
        return Buffer.from(`  URL: ${BASE_URL}?features=flags\n`);
      if (c.includes('mcp remove')) throw new Error('remove blew up');
      return Buffer.from('');
    });
    const client = new ClaudeCodeMCPClient();
    await expect(client.addServer(['workflows'])).resolves.toEqual({
      success: false,
      reason: 'remove blew up',
    });
    expect(analytics.captureException).toHaveBeenCalled();
  });

  it('returns failure with the reason on an unexpected add error', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (String(cmd).includes('mcp" "add')) throw new Error('spawn EPERM');
      return Buffer.from('');
    });
    const client = new ClaudeCodeMCPClient();
    await expect(client.addServer()).resolves.toEqual({
      success: false,
      reason: 'spawn EPERM',
    });
    expect(analytics.captureException).toHaveBeenCalled();
  });
});

describe('ClaudeCodeMCPClient — plugin methods', () => {
  const execSyncMock = execSync as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    // Make binary discoverable via PATH by default
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'command -v claude') return Buffer.from('');
      return Buffer.from('');
    });
  });

  describe('supportsPlugin', () => {
    it('returns true when claude binary is found', () => {
      const client = new ClaudeCodeMCPClient();
      expect(client.supportsPlugin()).toBe(true);
    });

    it('returns false when no binary is found', () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new ClaudeCodeMCPClient();
      expect(client.supportsPlugin()).toBe(false);
    });
  });

  describe('isPluginInstalled', () => {
    it('returns true when posthog appears in plugin list output', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin list'))
          return Buffer.from('posthog  1.0.0\n');
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(true);
    });

    it('returns false when posthog is absent from plugin list output', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin list'))
          return Buffer.from('other-plugin  2.0.0\n');
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });

    it('returns false when plugin list command throws', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        throw new Error('command failed');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });
  });

  describe('installPlugin', () => {
    it('returns success on exit 0', async () => {
      execSyncMock.mockImplementation(() => Buffer.from(''));
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });
    });

    it('returns success with alreadyInstalled when stderr contains "already installed"', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (String(cmd).includes('plugin install')) {
          throw new Error('already installed');
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
    });

    it('returns success with alreadyInstalled when stderr contains "already exists"', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (String(cmd).includes('plugin install')) {
          throw new Error('already exists');
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
    });

    it('returns already-installed without running the install when plugin list already has posthog', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (String(cmd).includes('plugin list'))
          return Buffer.from('posthog  1.0.0\n');
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
      expect(
        execSyncMock.mock.calls.some((c) =>
          String(c[0]).includes('plugin install'),
        ),
      ).toBe(false);
    });

    it('returns failure with the reason and captures exception on unexpected error', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (String(cmd).includes('plugin install')) {
          throw new Error('network timeout');
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: false,
        reason: 'network timeout',
      });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('network timeout'),
        }),
      );
    });

    it('returns failure with a reason when no binary is found', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: false,
        reason: expect.stringContaining('PATH'),
      });
    });
  });
});
