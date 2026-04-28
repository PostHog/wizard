import { CursorMCPClient } from '../cursor';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
}));

jest.mock('../../../../utils/analytics', () => ({
  analytics: { captureException: jest.fn() },
}));

describe('CursorMCPClient — plugin methods', () => {
  const { execSync } = require('child_process');
  const { analytics } = require('../../../../utils/analytics');
  const execSyncMock = execSync as jest.Mock;

  const originalPlatform = process.platform;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  describe('supportsPlugin', () => {
    it('returns false on Linux', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });
      const client = new CursorMCPClient();
      expect(client.supportsPlugin()).toBe(false);
    });

    it('returns false when cursor binary is not found on macOS', () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new CursorMCPClient();
      expect(client.supportsPlugin()).toBe(false);
    });

    it('returns true when cursor is found in PATH on macOS', () => {
      execSyncMock.mockImplementation(() => Buffer.from(''));
      const client = new CursorMCPClient();
      expect(client.supportsPlugin()).toBe(true);
    });
  });

  describe('installPlugin', () => {
    it('returns success on exit 0', async () => {
      execSyncMock.mockImplementation(() => Buffer.from(''));
      const client = new CursorMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });
    });

    it('returns failure when binary is not found', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new CursorMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
    });

    it('returns success with alreadyInstalled when extension is already installed', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v cursor') return Buffer.from('');
        if (String(cmd).includes('--install-extension'))
          throw new Error('already installed');
        return Buffer.from('');
      });
      const client = new CursorMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
    });

    it('returns failure and captures exception on unexpected error', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v cursor') return Buffer.from('');
        if (String(cmd).includes('--install-extension'))
          throw new Error('marketplace unreachable');
        return Buffer.from('');
      });
      const client = new CursorMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('marketplace unreachable'),
        }),
      );
    });
  });
});
