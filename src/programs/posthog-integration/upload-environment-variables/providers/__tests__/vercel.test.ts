import { VercelEnvironmentProvider } from '@programs/posthog-integration/upload-environment-variables/providers/vercel';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { findTrustedCommand } from '@shared/trusted-command';

vi.mock('fs');
vi.mock('@shared/trusted-command');
vi.mock('child_process');

const mockOptions = {
  installDir: '/tmp/project',
  runner: {
    log: { info: vi.fn(), warn: vi.fn() },
    spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  },
};

describe('VercelEnvironmentProvider', () => {
  let provider: VercelEnvironmentProvider;

  beforeEach(() => {
    provider = new VercelEnvironmentProvider(mockOptions as any);
    vi.clearAllMocks();
    vi.mocked(findTrustedCommand).mockReturnValue({
      executable: '/trusted/vercel',
      prefixArgs: [],
      env: { PATH: '/trusted' },
    });
  });

  it('should detect Vercel CLI, project link, and authentication', async () => {
    (child_process.execFileSync as Mock).mockReturnValue(undefined);
    (fs.existsSync as Mock).mockImplementation((p: string) => {
      if (p.endsWith('.vercel')) return true;
      if (p.endsWith('project.json')) return true;
      return false;
    });
    (child_process.spawnSync as Mock).mockReturnValue({
      stdout: 'testuser',
      stderr: '',
      status: 0,
    });

    await expect(provider.detect()).resolves.toBe(true);
  });

  it('should return false if Vercel CLI is missing', async () => {
    (child_process.execFileSync as Mock).mockImplementation(() => {
      throw new Error();
    });
    await expect(provider.detect()).resolves.toBe(false);
  });

  it('does not probe or upload through an untrusted Vercel executable', async () => {
    vi.mocked(findTrustedCommand).mockReturnValue(null);
    await expect(provider.detect()).resolves.toBe(false);
    await expect(
      provider.uploadEnvironmentVariable('FOO', 'secret', 'production'),
    ).rejects.toThrow('No trusted Vercel CLI');
    expect(child_process.execFileSync).not.toHaveBeenCalled();
    expect(child_process.spawn).not.toHaveBeenCalled();
  });

  it('should return false if project is not linked', async () => {
    (child_process.execFileSync as Mock).mockReturnValue(undefined);
    (fs.existsSync as Mock).mockReturnValue(false);
    await expect(provider.detect()).resolves.toBe(false);
  });

  it('should return false if not authenticated', async () => {
    (child_process.execFileSync as Mock).mockReturnValue(undefined);
    (fs.existsSync as Mock).mockReturnValue(true);
    (child_process.spawnSync as Mock).mockReturnValue({
      stdout: 'Log in to Vercel',
      stderr: '',
      status: 0,
    });
    await expect(provider.detect()).resolves.toBe(false);
  });

  it('should return false if env var already exists', async () => {
    const stdinMock = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
    let closeCallback: ((code: number) => void) | undefined;
    const onMock = vi.fn((event, cb) => {
      if (event === 'close') closeCallback = cb;
    });

    // Simulate a process with a writable stderr stream
    let stderrListener: ((data: Buffer | string) => void) | undefined;
    const stderr = {
      on: vi.fn((event, cb) => {
        if (event === 'data') stderrListener = cb;
      }),
    };

    (child_process.spawn as Mock).mockReturnValue({
      stdin: stdinMock,
      on: onMock,
      stderr,
    });

    const uploadPromise = provider.uploadEnvironmentVariable(
      'FOO',
      'bar',
      'production',
    );

    // Simulate "already exists" error on stderr, then process close
    stderrListener && stderrListener('already exists');
    closeCallback && closeCallback(1);

    await expect(uploadPromise).rejects.toThrow('already exists');
  });

  it('should attempt to upload environment variables', async () => {
    (child_process.spawn as Mock).mockImplementation(() => ({
      stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === 'close') queueMicrotask(() => cb(0));
      }),
    }));

    await expect(provider.uploadEnvVars({ FOO: 'bar' })).resolves.toEqual({
      FOO: true,
    });

    expect(child_process.spawn).toHaveBeenCalledWith(
      '/trusted/vercel',
      ['env', 'add', 'FOO', 'production'],
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/trusted' },
      }),
    );
  });
});
