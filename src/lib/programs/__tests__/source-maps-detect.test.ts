import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectSourceMapsPrerequisites,
  SOURCE_MAPS_CONTEXT_KEYS,
} from '@lib/programs/error-tracking-upload-source-maps/index';
import { buildSession } from '@lib/wizard-session';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'source-maps-detect-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writePackageJson(
  dir: string,
  deps: Record<string, string> = {},
  devDeps: Record<string, string> = {},
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      dependencies: deps,
      ...(Object.keys(devDeps).length > 0 ? { devDependencies: devDeps } : {}),
    }),
  );
}

describe('detectSourceMapsPrerequisites', () => {
  let tmpDir: string;
  let ctx: Record<string, unknown>;
  let setCtx: jest.Mock;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    ctx = {};
    setCtx = jest.fn((key: string, value: unknown) => {
      ctx[key] = value;
    });
  });

  afterEach(() => cleanup(tmpDir));

  it('errors when install directory is missing', () => {
    const session = buildSession({ installDir: '/nonexistent/path' });
    detectSourceMapsPrerequisites(session, setCtx);

    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError]).toEqual(
      expect.objectContaining({ kind: 'bad-directory', reason: 'missing' }),
    );
  });

  it('errors when install directory is not a directory', () => {
    const filePath = path.join(tmpDir, 'not-a-dir');
    fs.writeFileSync(filePath, '');

    const session = buildSession({ installDir: filePath });
    detectSourceMapsPrerequisites(session, setCtx);

    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError]).toEqual(
      expect.objectContaining({ kind: 'bad-directory', reason: 'not-dir' }),
    );
  });

  it('errors when no project files are found', () => {
    const session = buildSession({ installDir: tmpDir });
    detectSourceMapsPrerequisites(session, setCtx);

    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError]).toEqual({
      kind: 'no-project-files',
    });
  });

  it('errors with unsupported-platform when files exist but stack is unknown', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'hello');

    const session = buildSession({ installDir: tmpDir });
    detectSourceMapsPrerequisites(session, setCtx);

    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError]).toEqual({
      kind: 'unsupported-platform',
      detected: 'unknown',
    });
  });

  it.each([
    ['react-native', { 'react-native': '0.74.0' }],
    ['flutter', {}],
    ['ios', {}],
    ['android', {}],
  ] as const)(
    'errors with unsupported-platform for native stack %s',
    (variant, deps) => {
      if (variant === 'flutter') {
        fs.writeFileSync(path.join(tmpDir, 'pubspec.yaml'), 'name: myapp\n');
      } else if (variant === 'ios') {
        fs.mkdirSync(path.join(tmpDir, 'MyApp.xcodeproj'));
      } else if (variant === 'android') {
        fs.writeFileSync(path.join(tmpDir, 'build.gradle'), '');
      } else {
        writePackageJson(tmpDir, deps);
      }

      const session = buildSession({ installDir: tmpDir });
      detectSourceMapsPrerequisites(session, setCtx);

      expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError]).toEqual({
        kind: 'unsupported-platform',
        detected: variant,
      });
    },
  );

  it('errors when PostHog SDK is missing for a supported JS stack', () => {
    writePackageJson(tmpDir, { next: '14.0.0' });

    const session = buildSession({ installDir: tmpDir });
    detectSourceMapsPrerequisites(session, setCtx);

    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError]).toEqual({
      kind: 'no-posthog-sdk',
      platform: 'nextjs',
    });
  });

  it.each([
    ['nextjs', { next: '14.0.0' }, 'Next.js'],
    ['vite', { vite: '5.0.0' }, 'Vite'],
    ['webpack', { webpack: '5.0.0' }, 'Webpack'],
    ['rollup', { rollup: '4.0.0' }, 'Rollup'],
    ['react', { react: '18.0.0' }, 'React'],
    ['angular', { '@angular/core': '17.0.0' }, 'Angular'],
    ['nuxt', { nuxt: '3.0.0' }, 'Nuxt'],
    ['node', { 'posthog-node': '4.0.0' }, 'Node.js'],
    ['web', {}, 'Web (JavaScript)'],
  ] as const)(
    'detects %s when PostHog SDK is present',
    (variant, deps, displayName) => {
      writePackageJson(tmpDir, { 'posthog-js': '1.0.0', ...deps });

      const session = buildSession({ installDir: tmpDir });
      detectSourceMapsPrerequisites(session, setCtx);

      expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError]).toBeUndefined();
      expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.skillVariant]).toBe(variant);
      expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.displayName]).toBe(displayName);
      expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.packagePaths]).toEqual([
        'package.json',
      ]);
    },
  );

  it('prefers framework-specific variants over bundlers', () => {
    writePackageJson(tmpDir, {
      'posthog-js': '1.0.0',
      next: '14.0.0',
      vite: '5.0.0',
    });

    const session = buildSession({ installDir: tmpDir });
    detectSourceMapsPrerequisites(session, setCtx);

    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.skillVariant]).toBe('nextjs');
  });

  it('aggregates dependencies across monorepo packages', () => {
    writePackageJson(tmpDir, { 'posthog-js': '1.0.0' });

    const appDir = path.join(tmpDir, 'apps', 'web');
    writePackageJson(appDir, { next: '14.0.0' });

    const session = buildSession({ installDir: tmpDir });
    detectSourceMapsPrerequisites(session, setCtx);

    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError]).toBeUndefined();
    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.skillVariant]).toBe('nextjs');
    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.packagePaths]).toEqual(
      expect.arrayContaining([
        'package.json',
        path.join('apps', 'web', 'package.json'),
      ]),
    );
    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.packagePaths]).toHaveLength(2);
  });

  it('detects PostHog SDK from devDependencies', () => {
    writePackageJson(tmpDir, { next: '14.0.0' }, { 'posthog-js': '1.0.0' });

    const session = buildSession({ installDir: tmpDir });
    detectSourceMapsPrerequisites(session, setCtx);

    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.detectError]).toBeUndefined();
    expect(ctx[SOURCE_MAPS_CONTEXT_KEYS.skillVariant]).toBe('nextjs');
  });
});
