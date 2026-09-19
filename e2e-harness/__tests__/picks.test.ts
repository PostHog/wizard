import fs from 'fs';
import os from 'os';
import path from 'path';
import { nativeVariantFor, pickIntegrationTarget } from '@e2e-harness/picks';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-picks-'));
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const pkg = (deps: Record<string, string>) =>
  JSON.stringify({ name: 'x', dependencies: deps });

describe('pickIntegrationTarget', () => {
  it('prefers the first instrumentable app under apps/ over packages/ and the root', async () => {
    const root = fixture({
      'package.json': pkg({ express: '4.19.0' }),
      'apps/web/package.json': pkg({ next: '15.0.0', react: '19.0.0' }),
      'packages/api/package.json': pkg({ express: '4.19.0' }),
    });
    expect(await pickIntegrationTarget(root)).toEqual({
      integration: 'nextjs',
      path: 'apps/web',
    });
  });

  it('falls back to the root for a single app, and to null for nothing detectable', async () => {
    expect(
      await pickIntegrationTarget(
        fixture({ 'package.json': pkg({ express: '4.19.0' }) }),
      ),
    ).toEqual({ integration: 'javascript_node', path: '.' });
    expect(
      await pickIntegrationTarget(fixture({ 'README.md': '' })),
    ).toBeNull();
  });
});

describe('nativeVariantFor', () => {
  it('trusts what the detector recognised before reading manifests', () => {
    const root = fixture({ 'go.mod': 'module x' });
    expect(nativeVariantFor(root, { detected: 'flutter' })).toBe('flutter');
    expect(nativeVariantFor(root, { detected: 'unknown' })).toBe('go');
    expect(nativeVariantFor(root, undefined)).toBe('go');
  });

  it('names the platform from its manifest, or an Xcode project, else null', () => {
    expect(nativeVariantFor(fixture({ 'Cargo.toml': '' }), undefined)).toBe(
      'rust',
    );
    expect(
      nativeVariantFor(fixture({ 'settings.gradle': '' }), undefined),
    ).toBe('android');
    expect(
      nativeVariantFor(
        fixture({ 'App.xcodeproj/project.pbxproj': '' }),
        undefined,
      ),
    ).toBe('ios');
    expect(
      nativeVariantFor(fixture({ 'README.md': '' }), undefined),
    ).toBeNull();
    expect(nativeVariantFor('/nonexistent/root', undefined)).toBeNull();
  });
});
