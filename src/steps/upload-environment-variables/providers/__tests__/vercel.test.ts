import { VercelEnvironmentProvider } from '@steps/upload-environment-variables/providers/vercel';
import * as fs from 'fs';
import * as child_process from 'child_process';

jest.mock('fs');
jest.mock('child_process');

const mockOptions = { installDir: '/tmp/project' };

describe('VercelEnvironmentProvider', () => {
  let provider: VercelEnvironmentProvider;

  beforeEach(() => {
    provider = new VercelEnvironmentProvider(mockOptions as any);
    jest.clearAllMocks();
  });

  it('should detect Vercel CLI, project link, and authentication', async () => {
    (child_process.execSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      if (p.endsWith('.vercel')) return true;
      if (p.endsWith('project.json')) return true;
      return false;
    });
    (child_process.spawnSync as jest.Mock).mockReturnValue({
      stdout: 'testuser',
      stderr: '',
      status: 0,
    });

    await expect(provider.detect()).resolves.toBe(true);
  });

  it('should return false if Vercel CLI is missing', async () => {
    (child_process.execSync as jest.Mock).mockImplementation(() => {
      throw new Error();
    });
    await expect(provider.detect()).resolves.toBe(false);
  });

  it('should return false if project is not linked', async () => {
    (child_process.execSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    await expect(provider.detect()).resolves.toBe(false);
  });

  it('should return false if not authenticated', async () => {
    (child_process.execSync as jest.Mock).mockReturnValue(undefined);
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (child_process.spawnSync as jest.Mock).mockReturnValue({
      stdout: 'Log in to Vercel',
      stderr: '',
      status: 0,
    });
    await expect(provider.detect()).resolves.toBe(false);
  });

  it('should return false if env var already exists', async () => {
    const stdinMock = { write: jest.fn(), end: jest.fn() };
    let closeCallback: ((code: number) => void) | undefined;
    const onMock = jest.fn((event, cb) => {
      if (event === 'close') closeCallback = cb;
    });

    // Simulate a process with a writable stderr stream
    let stderrListener: ((data: Buffer | string) => void) | undefined;
    const stderr = {
      on: jest.fn((event, cb) => {
        if (event === 'data') stderrListener = cb;
      }),
    };

    (child_process.spawn as jest.Mock).mockReturnValue({
      stdin: stdinMock,
      on: onMock,
      stderr,
    });

    const uploadPromise = provider.uploadEnvVars({ FOO: 'bar' });

    // Simulate "already exists" error on stderr, then process close
    stderrListener && stderrListener('already exists');
    closeCallback && closeCallback(1);

    await expect(uploadPromise).resolves.toEqual({ FOO: false });
  });

  it('should attempt to upload environment variables', async () => {
    (child_process.spawn as jest.Mock).mockReturnValue({});

    await provider.uploadEnvVars({ FOO: 'bar' });

    expect(child_process.spawn).toHaveBeenCalledWith(
      'vercel',
      ['env', 'add', 'FOO', 'production'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    );
  });
});
