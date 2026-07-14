import { VercelEnvironmentProvider } from '@steps/upload-environment-variables/providers/vercel';
import { EnvUploadSkipCause } from '@steps/upload-environment-variables/EnvironmentProvider';
import * as fs from 'fs';
import * as child_process from 'child_process';

vi.mock('fs');
vi.mock('child_process');

const mockOptions = { installDir: '/tmp/project' };

type VercelResponse = { code: number; stderr?: string };

/**
 * The three environments upload concurrently, so responses are keyed by the
 * `vercel` arguments (and the nth identical invocation) rather than by a flat
 * queue, which would be order-dependent.
 */
function mockSpawn(respond: (args: string[], nth: number) => VercelResponse): {
  calls: string[][];
} {
  const calls: string[][] = [];
  const seen = new Map<string, number>();

  (child_process.spawn as Mock).mockImplementation(
    (_cmd: string, args: string[]) => {
      calls.push(args);
      const signature = args.join(' ');
      const nth = seen.get(signature) ?? 0;
      seen.set(signature, nth + 1);
      const { code, stderr } = respond(args, nth);

      return {
        stdin: { write: vi.fn(), end: vi.fn() },
        stderr: {
          on: (event: string, cb: (data: string) => void) => {
            if (event === 'data' && stderr) cb(stderr);
          },
        },
        on: (event: string, cb: (arg: unknown) => void) => {
          if (event === 'close') setImmediate(() => cb(code));
        },
      };
    },
  );

  return { calls };
}

const isProductionAdd = (args: string[]): boolean =>
  args[1] === 'add' && args[3] === 'production';

describe('VercelEnvironmentProvider', () => {
  let provider: VercelEnvironmentProvider;

  beforeEach(() => {
    provider = new VercelEnvironmentProvider(mockOptions as any);
    vi.clearAllMocks();
  });

  it('should detect Vercel CLI, project link, and authentication', async () => {
    (child_process.execSync as Mock).mockReturnValue(undefined);
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
    (child_process.execSync as Mock).mockImplementation(() => {
      throw new Error();
    });
    await expect(provider.detect()).resolves.toBe(false);
  });

  it('should return false if project is not linked', async () => {
    (child_process.execSync as Mock).mockReturnValue(undefined);
    (fs.existsSync as Mock).mockReturnValue(false);
    await expect(provider.detect()).resolves.toBe(false);
  });

  it('should return false if not authenticated', async () => {
    (child_process.execSync as Mock).mockReturnValue(undefined);
    (fs.existsSync as Mock).mockReturnValue(true);
    (child_process.spawnSync as Mock).mockReturnValue({
      stdout: 'Log in to Vercel',
      stderr: '',
      status: 0,
    });
    await expect(provider.detect()).resolves.toBe(false);
  });

  describe('deploy marker detection', () => {
    it.each([
      ['.vercel directory', '.vercel', true],
      ['vercel.json', 'vercel.json', true],
    ])('should find markers via %s', (_label, marker, expected) => {
      (fs.existsSync as Mock).mockImplementation((p: string) =>
        p.endsWith(marker),
      );
      expect(provider.hasDeployMarkers()).toBe(expected);
    });

    it('should find no markers in a non-Vercel project', () => {
      (fs.existsSync as Mock).mockReturnValue(false);
      expect(provider.hasDeployMarkers()).toBe(false);
    });
  });

  describe('describeSkip', () => {
    it('should return null before detect() has run', () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      expect(provider.describeSkip(['FOO'])).toBeNull();
    });

    it('should return null when the project has no Vercel markers', async () => {
      (child_process.execSync as Mock).mockImplementation(() => {
        throw new Error();
      });
      (fs.existsSync as Mock).mockReturnValue(false);

      await provider.detect();

      expect(provider.describeSkip(['FOO'])).toBeNull();
    });

    it.each([
      [
        'cli missing',
        () => {
          (child_process.execSync as Mock).mockImplementation(() => {
            throw new Error();
          });
          (fs.existsSync as Mock).mockImplementation((p: string) =>
            p.endsWith('vercel.json'),
          );
        },
        EnvUploadSkipCause.CliMissing,
      ],
      [
        'project unlinked',
        () => {
          (child_process.execSync as Mock).mockReturnValue(undefined);
          (fs.existsSync as Mock).mockImplementation((p: string) =>
            p.endsWith('vercel.json'),
          );
        },
        EnvUploadSkipCause.ProjectUnlinked,
      ],
      [
        'unauthenticated',
        () => {
          (child_process.execSync as Mock).mockReturnValue(undefined);
          (fs.existsSync as Mock).mockReturnValue(true);
          (child_process.spawnSync as Mock).mockReturnValue({
            stdout: 'Log in to Vercel',
            stderr: '',
            status: 0,
          });
        },
        EnvUploadSkipCause.Unauthenticated,
      ],
    ])('should attribute a skip to %s', async (_label, setup, cause) => {
      setup();

      await provider.detect();
      const skip = provider.describeSkip(['NEXT_PUBLIC_POSTHOG_KEY']);

      expect(skip).not.toBeNull();
      expect(skip!.cause).toBe(cause);
      expect(skip!.provider).toBe('Vercel');
      expect(skip!.message).toContain(
        'vercel env add NEXT_PUBLIC_POSTHOG_KEY production',
      );
    });

    it('should name every key without leaking its value', async () => {
      (child_process.execSync as Mock).mockImplementation(() => {
        throw new Error();
      });
      (fs.existsSync as Mock).mockImplementation((p: string) =>
        p.endsWith('vercel.json'),
      );

      await provider.detect();
      const skip = provider.describeSkip([
        'NEXT_PUBLIC_POSTHOG_KEY',
        'NEXT_PUBLIC_POSTHOG_HOST',
      ]);

      expect(skip!.message).toContain('NEXT_PUBLIC_POSTHOG_KEY');
      expect(skip!.message).toContain('NEXT_PUBLIC_POSTHOG_HOST');
      expect(skip!.message).not.toContain('phc_');
    });

    it('should return null once detect() succeeds', async () => {
      (child_process.execSync as Mock).mockReturnValue(undefined);
      (fs.existsSync as Mock).mockReturnValue(true);
      (child_process.spawnSync as Mock).mockReturnValue({
        stdout: 'testuser',
        stderr: '',
        status: 0,
      });

      await provider.detect();

      expect(provider.describeSkip(['FOO'])).toBeNull();
    });
  });

  describe('uploadEnvVars', () => {
    it('should attempt to upload environment variables', async () => {
      const { calls } = mockSpawn(() => ({ code: 0 }));

      await expect(provider.uploadEnvVars({ FOO: 'bar' })).resolves.toEqual({
        FOO: true,
      });

      expect(calls).toContainEqual(['env', 'add', 'FOO', 'production']);
    });

    it.each([['already exists'], ['already been added'], ['vercel env rm']])(
      'should replace the value when Vercel reports "%s"',
      async (stderr) => {
        const { calls } = mockSpawn((args, nth) =>
          isProductionAdd(args) && nth === 0
            ? { code: 1, stderr }
            : { code: 0 },
        );

        await expect(provider.uploadEnvVars({ FOO: 'bar' })).resolves.toEqual({
          FOO: true,
        });

        expect(calls).toContainEqual(['env', 'rm', 'FOO', 'production', '-y']);
        expect(calls.filter(isProductionAdd)).toHaveLength(2);
      },
    );

    it('should fail when the existing variable cannot be removed', async () => {
      mockSpawn((args, nth) => {
        if (isProductionAdd(args) && nth === 0) {
          return { code: 1, stderr: 'already exists' };
        }
        if (args[1] === 'rm') return { code: 1 };
        return { code: 0 };
      });

      await expect(provider.uploadEnvVars({ FOO: 'bar' })).resolves.toEqual({
        FOO: false,
      });
    });

    it('should fail on a genuine error without attempting a replace', async () => {
      const { calls } = mockSpawn((args) =>
        isProductionAdd(args)
          ? { code: 1, stderr: 'unexpected error from vercel' }
          : { code: 0 },
      );

      await expect(provider.uploadEnvVars({ FOO: 'bar' })).resolves.toEqual({
        FOO: false,
      });

      expect(calls.some((args) => args[1] === 'rm')).toBe(false);
    });
  });
});
