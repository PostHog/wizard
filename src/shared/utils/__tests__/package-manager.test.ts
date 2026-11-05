import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectNodePackageManagers } from '@utils/package-manager';
import { MAX_PROJECT_FILE_BYTES } from '@utils/bounded-fs';

vi.mock('@utils/debug');
vi.mock('@utils/analytics', () => ({
  analytics: { setTag: vi.fn(), captureException: vi.fn() },
}));

const NPM_FALLBACK = 'No lockfile found. Default to npm (npm add, npm run).';

describe('detectNodePackageManagers without a local lockfile', () => {
  let tmpDir: string;

  const writeManifest = (manifest: unknown) =>
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest),
    );

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-manifest-'));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('uses a declared pnpm packageManager', async () => {
    writeManifest({ packageManager: 'pnpm@9.12.0' });
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.primary?.name).toBe('pnpm');
    expect(result.detected).toEqual([result.primary]);
    expect(result.recommendation).toContain('pnpm add');
  });

  it.each([
    ['yarn@1.22.19', 'Yarn V1'],
    ['yarn@4.5.0+sha512.abc', 'Yarn V2/3/4'],
    ['bun@1.1.30', 'Bun'],
  ])('maps packageManager %s to %s', async (declared, label) => {
    writeManifest({ packageManager: declared });
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.primary?.label).toBe(label);
  });

  it.each([
    ['workspace:*', { dependencies: { '@acme/ui': 'workspace:*' } }],
    ['catalog:', { devDependencies: { react: 'catalog:' } }],
  ])('warns instead of recommending npm for %s', async (_, manifest) => {
    writeManifest({ name: 'app', ...manifest });
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.primary).toBeNull();
    expect(result.detected).toHaveLength(0);
    expect(result.recommendation).not.toBe(NPM_FALLBACK);
    expect(result.recommendation).toContain('workspace');
    expect(result.recommendation).toContain('Do not use npm');
  });

  it('prefers a declared manager over workspace specifiers', async () => {
    writeManifest({
      packageManager: 'pnpm@9.12.0',
      dependencies: { '@acme/ui': 'workspace:*' },
    });
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.primary?.name).toBe('pnpm');
  });

  it('warns for workspace specifiers with an invalid packageManager', async () => {
    writeManifest({
      packageManager: 'pnpm',
      dependencies: { '@acme/ui': 'workspace:^' },
    });
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.primary).toBeNull();
    expect(result.recommendation).toContain('Do not use npm');
  });

  it('keeps the npm fallback for a standalone package', async () => {
    writeManifest({ name: 'app', dependencies: { next: '^15.0.0' } });
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.primary).toBeNull();
    expect(result.recommendation).toBe(NPM_FALLBACK);
  });

  it('ignores an unsupported packageManager', async () => {
    writeManifest({ packageManager: 'deno@2.0.0' });
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.recommendation).toBe(NPM_FALLBACK);
  });

  it.each([
    ['missing', null],
    ['malformed', '{ "packageManager": '],
    ['not an object', '["pnpm@9.0.0"]'],
  ])('falls back to npm for a %s manifest', async (_, content) => {
    if (content !== null) writeManifest(content);
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.recommendation).toBe(NPM_FALLBACK);
  });

  it('falls back to npm for an oversized manifest', async () => {
    writeManifest(
      `{"packageManager":"pnpm@9.0.0","pad":"${'x'.repeat(
        MAX_PROJECT_FILE_BYTES,
      )}"}`,
    );
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.recommendation).toBe(NPM_FALLBACK);
  });

  it('keeps lockfile selection over the manifest', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    writeManifest({
      packageManager: 'pnpm@9.12.0',
      dependencies: { '@acme/ui': 'workspace:*' },
    });
    const result = await detectNodePackageManagers(tmpDir);
    expect(result.primary?.name).toBe('npm');
    expect(result.recommendation).toBe('Use npm (npm add).');
  });
});
