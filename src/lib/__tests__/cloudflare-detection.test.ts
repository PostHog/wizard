import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectCloudflareTarget } from '@lib/cloudflare-detection';

vi.mock('../../utils/debug');

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cloudflare-detect-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writePackageJson(dir: string, pkg: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
}

describe('detectCloudflareTarget', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });
  afterEach(() => cleanup(tmpDir));

  it('returns false for an empty directory', async () => {
    expect(await detectCloudflareTarget(tmpDir)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Criterion 1: wrangler config files
  // -------------------------------------------------------------------------

  describe('wrangler config detection', () => {
    it('detects wrangler.toml', async () => {
      fs.writeFileSync(path.join(tmpDir, 'wrangler.toml'), 'name = "app"');
      expect(await detectCloudflareTarget(tmpDir)).toBe(true);
    });

    it('detects wrangler.jsonc', async () => {
      fs.writeFileSync(path.join(tmpDir, 'wrangler.jsonc'), '{}');
      expect(await detectCloudflareTarget(tmpDir)).toBe(true);
    });

    it('detects wrangler.json', async () => {
      fs.writeFileSync(path.join(tmpDir, 'wrangler.json'), '{}');
      expect(await detectCloudflareTarget(tmpDir)).toBe(true);
    });

    it('detects wrangler config even when package.json is missing', async () => {
      fs.writeFileSync(path.join(tmpDir, 'wrangler.toml'), 'name = "app"');
      expect(await detectCloudflareTarget(tmpDir)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Criterion 2: Cloudflare adapter/platform packages
  // -------------------------------------------------------------------------

  describe('package dependency detection', () => {
    it.each([
      '@react-router/cloudflare',
      '@astrojs/cloudflare',
      '@sveltejs/adapter-cloudflare',
      '@sveltejs/adapter-cloudflare-workers',
      '@cloudflare/workers-types',
      'wrangler',
    ])('detects %s in dependencies', async (pkgName) => {
      writePackageJson(tmpDir, { dependencies: { [pkgName]: '^1.0.0' } });
      expect(await detectCloudflareTarget(tmpDir)).toBe(true);
    });

    it('detects Cloudflare package in devDependencies', async () => {
      writePackageJson(tmpDir, {
        devDependencies: { wrangler: '^3.0.0' },
      });
      expect(await detectCloudflareTarget(tmpDir)).toBe(true);
    });

    it('returns false when no Cloudflare packages are present', async () => {
      writePackageJson(tmpDir, {
        dependencies: { react: '^19.0.0', next: '^15.0.0' },
      });
      expect(await detectCloudflareTarget(tmpDir)).toBe(false);
    });

    it('returns false for an invalid package.json', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), 'not json');
      expect(await detectCloudflareTarget(tmpDir)).toBe(false);
    });

    it('does not match packages whose names merely contain "cloudflare"', async () => {
      writePackageJson(tmpDir, {
        dependencies: { 'some-cloudflare-lookalike': '^1.0.0' },
      });
      expect(await detectCloudflareTarget(tmpDir)).toBe(false);
    });
  });
});
