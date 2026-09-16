import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectExistingPostHog } from '@lib/programs/posthog-integration/detect';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ph-detect-'));
}

function writePackageJson(
  dir: string,
  pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = {},
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
}

describe('detectExistingPosthog', () => {
  let tmpDir: string;
  let setPosthogSdkDetected: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    setPosthogSdkDetected = vi.fn();
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const run = (dir: string) =>
    detectExistingPostHog({ setPosthogSdkDetected }, dir);

  it('reports false when no package.json exists', () => {
    run(tmpDir);
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(false);
  });

  it('reports false when dependencies have no PostHog SDK', () => {
    writePackageJson(tmpDir, { dependencies: { react: '^19.0.0' } });
    run(tmpDir);
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(false);
  });

  it('reports true for posthog-js in dependencies', () => {
    writePackageJson(tmpDir, { dependencies: { 'posthog-js': '^1.0.0' } });
    run(tmpDir);
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(true);
  });

  it('reports true for posthog-node in devDependencies', () => {
    writePackageJson(tmpDir, { devDependencies: { 'posthog-node': '^4.0.0' } });
    run(tmpDir);
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(true);
  });

  it('reports true for a PostHog SDK in a nested monorepo package', () => {
    writePackageJson(tmpDir, { dependencies: {} });
    writePackageJson(path.join(tmpDir, 'apps', 'web'), {
      dependencies: { 'posthog-js': '^1.0.0' },
    });
    run(tmpDir);
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(true);
  });

  it('does not throw and reports false for an invalid install dir', () => {
    expect(() => run('/nonexistent/path')).not.toThrow();
    expect(setPosthogSdkDetected).toHaveBeenCalledWith(false);
  });
});
