import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findSidecarVendors } from '@programs/side-car';

function writePackageJson(dir: string, deps: Record<string, string>): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: deps }),
  );
}

describe('findSidecarVendors', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-detect-'));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('finds no vendors in a project without them', () => {
    writePackageJson(tmpDir, { react: '^19.0.0' });
    expect(findSidecarVendors(tmpDir)).toEqual([]);
  });

  it('finds every vendor across a monorepo', () => {
    writePackageJson(path.join(tmpDir, 'apps', 'web'), {
      '@amplitude/analytics-browser': '^2.0.0',
      'mixpanel-browser': '^2.84.0',
    });
    writePackageJson(path.join(tmpDir, 'apps', 'admin'), {
      '@segment/analytics-next': '^1.84.0',
    });
    const vendors = findSidecarVendors(tmpDir)
      .map((m) => `${m.vendor}:${m.path}`)
      .sort();
    expect(vendors).toEqual([
      `amplitude:${path.join('apps', 'web', 'package.json')}`,
      `mixpanel:${path.join('apps', 'web', 'package.json')}`,
      `segment:${path.join('apps', 'admin', 'package.json')}`,
    ]);
  });

  it('ignores server-only vendor SDKs', () => {
    writePackageJson(tmpDir, {
      '@amplitude/analytics-node': '^1.0.0',
      mixpanel: '^0.18.0',
    });
    expect(findSidecarVendors(tmpDir)).toEqual([]);
  });
});
