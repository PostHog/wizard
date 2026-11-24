import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WIZARD_VERSIONED_SDK_SKILLS_FLAG_KEY } from '@shared/constants';
import { analytics } from '@utils/analytics';
import { rangeMajor } from '@utils/semver';
import { buildSession } from '@services/session/wizard-session';
import {
  DISCOVERY_KEY,
  getTraits,
  toMatchKeys,
  TRAITS,
  VERSIONED_SDK_SKILLS_ENABLED_KEY,
  type Discovery,
} from '@services/project-discovery';
import { discoverProjects } from '../projects';
import { declaredSdkMajor } from '../traits/sdk-major';
import { walkRepoFiles } from '../walk';

const createdDirs: string[] = [];

function makeDir(prefix = 'sdk-major-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function writeFile(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('rangeMajor', () => {
  it.each([
    ['7.40.0', 7],
    ['=7.40.0', 7],
    ['>=7.40.0 <8.0.0', 7],
    ['^5.28.1', 5],
    ['~3.1.0', 3],
    ['4.0.0-beta.1', 4],
    ['0.33.0', 0],
    ['=0.33.2', 0],
  ])('returns single major for %s -> %i', (range, expected) => {
    expect(rangeMajor(range)).toBe(expected);
  });

  it.each([
    '>=7.0',
    '*',
    '^7 || ^8',
    'latest',
    'workspace:*',
    'file:../pkg',
    '',
  ])('returns undefined for multi-major or non-semver %s', (range) => {
    expect(rangeMajor(range)).toBeUndefined();
  });
});

describe('flag-off parity for SDK traits', () => {
  it('returns {} with zero disk reads when the flag is off or unset', () => {
    const dir = makeDir();
    writeFile(dir, 'requirements.txt', 'posthog==7.40.0\n');
    writeFile(
      dir,
      'package.json',
      JSON.stringify({ dependencies: { 'posthog-node': '^5.0.0' } }),
    );
    writeFile(
      dir,
      'go.mod',
      'module x\nrequire github.com/posthog/posthog-go v1.6.0\n',
    );
    writeFile(dir, 'Cargo.toml', '[dependencies]\nposthog-rs = "0.33"\n');
    writeFile(dir, 'Podfile', "pod 'PostHog', '~> 3.0'\n");
    writeFile(
      dir,
      'app/build.gradle.kts',
      'implementation("com.posthog:posthog-android:3.14.0")\n',
    );
    writeFile(
      dir,
      'pubspec.yaml',
      'dependencies:\n  posthog_flutter: ^5.0.0\n',
    );
    writeFile(
      dir,
      'shared/build.gradle.kts',
      'implementation("com.posthog:posthog-kmp:0.5.0")\n',
    );

    const readSpy = vi.spyOn(fs, 'readFileSync');
    const statSpy = vi.spyOn(fs, 'statSync');
    const readdirSpy = vi.spyOn(fs, 'readdirSync');

    vi.spyOn(analytics, 'getCachedWizardFlags').mockReturnValue(null);
    const unsetSession = buildSession({ installDir: dir });
    expect(getTraits(unsetSession)).toEqual({});
    expect(toMatchKeys(getTraits(unsetSession))).toEqual({});

    vi.spyOn(analytics, 'getCachedWizardFlags').mockReturnValue({
      [WIZARD_VERSIONED_SDK_SKILLS_FLAG_KEY]: 'true',
    });
    const staleCachedAnonSession = buildSession({ installDir: dir });
    expect(getTraits(staleCachedAnonSession)).toEqual({});
    expect(toMatchKeys(getTraits(staleCachedAnonSession))).toEqual({});

    vi.spyOn(analytics, 'getCachedWizardFlags').mockReturnValue({
      [WIZARD_VERSIONED_SDK_SKILLS_FLAG_KEY]: 'false',
    });
    const falseSession = buildSession({ installDir: dir });
    expect(getTraits(falseSession)).toEqual({});

    const disabledCtxSession = buildSession({ installDir: dir });
    disabledCtxSession.frameworkContext = {
      [VERSIONED_SDK_SKILLS_ENABLED_KEY]: false,
    };
    expect(getTraits(disabledCtxSession)).toEqual({});

    expect(readSpy).not.toHaveBeenCalled();
    expect(statSpy).not.toHaveBeenCalled();
    expect(readdirSpy).not.toHaveBeenCalled();
  });
});

describe('declaredSdkMajor across all 8 ecosystems (BEFORE vs AFTER)', () => {
  it('detects Python BEFORE (3..7) and AFTER (8) across manifests and lockfiles', () => {
    for (const [spec, major] of [
      ['posthog>=3.1,<4', '3'],
      ['posthog==4.10.0', '4'],
      ['posthog~=5.4', '5'],
      ['posthog==6.0.0', '6'],
      ['posthog==7.40.0', '7'],
      ['posthog>=8.0.0,<9', '8'],
    ] as const) {
      const dir = makeDir('py-req-');
      writeFile(dir, 'requirements.txt', `${spec}\n`);
      expect(declaredSdkMajor(dir, 'python')).toBe(major);
    }

    const pep621Dir = makeDir('py-pep621-');
    writeFile(
      pep621Dir,
      'pyproject.toml',
      '[project]\ndependencies = ["fastapi>=0.1", "posthog>=7.40.0,<8"]\n',
    );
    expect(declaredSdkMajor(pep621Dir, 'python')).toBe('7');

    const poetryDir = makeDir('py-poetry-');
    writeFile(
      poetryDir,
      'pyproject.toml',
      '[tool.poetry.dependencies]\npython = "^3.12"\nposthog = "^7.1.0"\n',
    );
    expect(declaredSdkMajor(poetryDir, 'python')).toBe('7');

    const pipfileDir = makeDir('py-pipfile-');
    writeFile(pipfileDir, 'Pipfile', '[packages]\nposthog = "~=6.0"\n');
    expect(declaredSdkMajor(pipfileDir, 'python')).toBe('6');

    const uvDir = makeDir('py-uv-');
    writeFile(uvDir, 'requirements.txt', 'posthog>=7\n');
    writeFile(
      uvDir,
      'uv.lock',
      '[[package]]\nname = "posthog"\nversion = "7.42.0"\n',
    );
    expect(declaredSdkMajor(uvDir, 'python')).toBe('7');

    const pipfileLockDir = makeDir('py-pipfile-lock-');
    writeFile(pipfileLockDir, 'Pipfile', '[packages]\nposthog = "*"\n');
    writeFile(
      pipfileLockDir,
      'Pipfile.lock',
      JSON.stringify({ default: { posthog: { version: '==8.1.0' } } }),
    );
    expect(declaredSdkMajor(pipfileLockDir, 'python')).toBe('8');
  });

  it('detects Node BEFORE (4, 5) and AFTER (6) across package.json, node_modules, and package-lock.json', () => {
    for (const [ver, major] of [
      ['^4.18.0', '4'],
      ['^5.28.1', '5'],
      ['^6.0.0', '6'],
    ] as const) {
      const dir = makeDir('node-');
      writeFile(
        dir,
        'package.json',
        JSON.stringify({ dependencies: { 'posthog-node': ver } }),
      );
      expect(declaredSdkMajor(dir, 'node')).toBe(major);
    }

    const lockDir = makeDir('node-lock-');
    writeFile(
      lockDir,
      'package.json',
      JSON.stringify({ dependencies: { 'posthog-node': '>=5' } }),
    );
    writeFile(
      lockDir,
      'package-lock.json',
      JSON.stringify({
        packages: { 'node_modules/posthog-node': { version: '6.2.1' } },
      }),
    );
    expect(declaredSdkMajor(lockDir, 'node')).toBe('6');

    const nmDir = makeDir('node-nm-');
    writeFile(
      nmDir,
      'package.json',
      JSON.stringify({ dependencies: { 'posthog-node': '*' } }),
    );
    writeFile(
      nmDir,
      'node_modules/posthog-node/package.json',
      JSON.stringify({ name: 'posthog-node', version: '5.19.0' }),
    );
    expect(declaredSdkMajor(nmDir, 'node')).toBe('5');
  });

  it('detects Go BEFORE (1) and AFTER (2)', () => {
    const before = makeDir('go1-');
    writeFile(
      before,
      'go.mod',
      'module example.com/app\n\nrequire github.com/posthog/posthog-go v1.6.14\n',
    );
    expect(declaredSdkMajor(before, 'go')).toBe('1');

    const after = makeDir('go2-');
    writeFile(
      after,
      'go.mod',
      'module example.com/app\n\nrequire github.com/posthog/posthog-go/v2 v2.1.1\n',
    );
    expect(declaredSdkMajor(after, 'go')).toBe('2');
  });

  it('detects Rust BEFORE (0 / posthog-rs) and AFTER (1 / posthog)', () => {
    const before = makeDir('rust0-');
    writeFile(before, 'Cargo.toml', '[dependencies]\nposthog-rs = "0.33"\n');
    expect(declaredSdkMajor(before, 'rust')).toBe('0');

    const after = makeDir('rust1-');
    writeFile(
      after,
      'Cargo.toml',
      '[dependencies.posthog]\nversion = "=1.3.0"\n',
    );
    expect(declaredSdkMajor(after, 'rust')).toBe('1');

    const wsRoot = makeDir('rust-ws-');
    writeFile(
      wsRoot,
      'Cargo.toml',
      '[workspace.dependencies]\nposthog-rs = "0.33.1"\n',
    );
    writeFile(
      wsRoot,
      'crates/api/Cargo.toml',
      '[dependencies]\nposthog-rs = { workspace = true }\n',
    );
    expect(
      declaredSdkMajor(path.join(wsRoot, 'crates/api'), 'rust', wsRoot),
    ).toBe('0');
  });

  it('detects iOS BEFORE (3) and AFTER (4) across Podfile, Package.swift, project.yml, pbxproj, and lockfiles', () => {
    const podPinned = makeDir('ios-pod-');
    writeFile(podPinned, 'Podfile', "pod 'PostHog', '~> 3.0'\n");
    expect(declaredSdkMajor(podPinned, 'ios')).toBe('3');

    const podUnpinned = makeDir('ios-pod-unpinned-');
    writeFile(podUnpinned, 'Podfile', "pod 'PostHog'\n");
    expect(declaredSdkMajor(podUnpinned, 'ios')).toBe('3');

    const spmBefore = makeDir('ios-spm3-');
    writeFile(
      spmBefore,
      'Package.swift',
      '.package(url: "https://github.com/PostHog/posthog-ios.git", "3.0.0"..<"4.0.0")',
    );
    expect(declaredSdkMajor(spmBefore, 'ios')).toBe('3');

    const spmAfter = makeDir('ios-spm4-');
    writeFile(
      spmAfter,
      'Package.swift',
      '.package(url: "https://github.com/PostHog/posthog-ios.git", from: "4.1.0")',
    );
    expect(declaredSdkMajor(spmAfter, 'ios')).toBe('4');

    const resolvedDir = makeDir('ios-resolved-');
    writeFile(
      resolvedDir,
      'Package.swift',
      '.package(url: "https://github.com/PostHog/posthog-ios.git", branch: "main")',
    );
    writeFile(
      resolvedDir,
      'Package.resolved',
      JSON.stringify({
        pins: [
          {
            identity: 'posthog-ios',
            state: { version: '4.2.0' },
          },
        ],
      }),
    );
    expect(declaredSdkMajor(resolvedDir, 'ios')).toBe('4');

    const ymlDir = makeDir('ios-yml-');
    writeFile(
      ymlDir,
      'project.yml',
      'packages:\n  PostHog:\n    url: https://github.com/PostHog/posthog-ios\n    from: 3.21.0\n',
    );
    expect(declaredSdkMajor(ymlDir, 'ios')).toBe('3');

    const pbxDir = makeDir('ios-pbx-');
    writeFile(
      pbxDir,
      'App.xcodeproj/project.pbxproj',
      `/* XCRemoteSwiftPackageReference "posthog-ios" */ = {\n  isa = XCRemoteSwiftPackageReference;\n  repositoryURL = "https://github.com/PostHog/posthog-ios.git";\n  requirement = {\n    kind = upToNextMajorVersion;\n    minimumVersion = 4.0.0;\n  };\n};`,
    );
    expect(declaredSdkMajor(pbxDir, 'ios')).toBe('4');
  });

  it('detects Android BEFORE (3) and AFTER (4)', () => {
    const before = makeDir('android3-');
    writeFile(
      before,
      'app/build.gradle.kts',
      'implementation("com.posthog:posthog-android:3.14.0")\n',
    );
    expect(declaredSdkMajor(before, 'android')).toBe('3');

    const after = makeDir('android4-');
    writeFile(after, 'app/build.gradle.kts', 'implementation(libs.posthog)\n');
    writeFile(
      after,
      'gradle/libs.versions.toml',
      '[versions]\nposthog = "4.1.0"\n[libraries]\nposthog = { group = "com.posthog", name = "posthog-android", version.ref = "posthog" }\nposthog-kmp = "com.posthog:posthog-kmp:1.0.0"\n',
    );
    expect(declaredSdkMajor(after, 'android')).toBe('4');
    // Calling only libs.posthog must not trigger posthog-kmp and vice versa.
    const kmpOnly = makeDir('android-vs-kmp-alias-');
    writeFile(
      kmpOnly,
      'app/build.gradle.kts',
      'implementation(libs.posthog.kmp)\n',
    );
    writeFile(
      kmpOnly,
      'gradle/libs.versions.toml',
      '[libraries]\nposthog = "com.posthog:posthog-android:4.1.0"\nposthog-kmp = "com.posthog:posthog-kmp:1.0.0"\n',
    );
    expect(declaredSdkMajor(kmpOnly, 'android')).toBeUndefined();
  });

  it('detects Flutter BEFORE (4, 5) and AFTER (6)', () => {
    const v4 = makeDir('flutter4-');
    writeFile(
      v4,
      'pubspec.yaml',
      'dependencies:\n  posthog_flutter: ^4.10.0\n',
    );
    expect(declaredSdkMajor(v4, 'flutter')).toBe('4');

    const v5Locked = makeDir('flutter5-');
    writeFile(
      v5Locked,
      'pubspec.yaml',
      'dependencies:\n  posthog_flutter: any\n',
    );
    writeFile(
      v5Locked,
      'pubspec.lock',
      'packages:\n  posthog_flutter:\n    dependency: "direct main"\n    version: "5.8.0"\n',
    );
    expect(declaredSdkMajor(v5Locked, 'flutter')).toBe('5');

    const v6 = makeDir('flutter6-');
    writeFile(v6, 'pubspec.yaml', 'dependencies:\n  posthog_flutter: ^6.0.0\n');
    expect(declaredSdkMajor(v6, 'flutter')).toBe('6');
  });

  it('detects KMP BEFORE (0) and AFTER (1)', () => {
    const before = makeDir('kmp0-');
    writeFile(
      before,
      'shared/build.gradle.kts',
      'implementation("com.posthog:posthog-kmp:0.5.0")\n',
    );
    expect(declaredSdkMajor(before, 'kmp')).toBe('0');

    const after = makeDir('kmp1-');
    writeFile(
      after,
      'shared/build.gradle.kts',
      'implementation(libs.posthog.kmp)\n',
    );
    writeFile(
      after,
      'gradle/libs.versions.toml',
      '[libraries]\nposthog-kmp = "com.posthog:posthog-kmp:1.0.0"\n',
    );
    expect(declaredSdkMajor(after, 'kmp')).toBe('1');
  });

  it('scopes traits per monorepo projectPath and ignores malformed manifests', () => {
    const ws = makeDir('monorepo-');
    writeFile(ws, 'apps/api/requirements.txt', 'posthog==7.40.0\n');
    writeFile(
      ws,
      'apps/web/package.json',
      JSON.stringify({ dependencies: { 'posthog-node': '^6.1.0' } }),
    );
    writeFile(ws, 'apps/broken/package.json', '{not valid json');

    const discovery: Discovery = {
      program: 'posthog-integration',
      discoveredAt: '2026-11-23T00:00:00.000Z',
      rootDir: ws,
      runDir: path.join(ws, 'apps/api'),
      runProject: 'apps/api',
      mode: 'one-project',
      files: {
        dir: ws,
        files: [],
        manifests: [],
        lockfiles: [],
        envKeys: [],
        workspaceMarkers: [],
        scriptHosts: [],
        complete: true,
        truncated: false,
      },
      tools: { tools: [], complete: true },
      projects: {
        repoType: 'monorepo',
        workspaces: [],
        projects: [],
        complete: true,
      },
      detected: {},
    };
    const session = buildSession({ installDir: path.join(ws, 'apps/api') });
    session.runProject = 'apps/api';
    session.frameworkContext = {
      [DISCOVERY_KEY]: discovery,
      [VERSIONED_SDK_SKILLS_ENABLED_KEY]: true,
    };

    expect(getTraits(session, 'apps/api').sdkPython).toBe('7');
    expect(toMatchKeys(getTraits(session, 'apps/api'))).toEqual({
      sdkPython: ['7'],
    });
    expect(getTraits(session, 'apps/web').sdkNode).toBe('6');
    expect(getTraits(session, 'apps/broken')).toEqual({});
    expect(
      declaredSdkMajor(path.join(ws, 'apps/broken'), 'node'),
    ).toBeUndefined();
  });

  it('handles PEP 621 extras, hashed requirements, indirect go.mod, iOS regex backtracking, and Gradle monorepo isolation', () => {
    // PEP 621 extras before posthog must not close the dependencies array match early.
    const pepExtras = makeDir('py-pep621-extras-');
    writeFile(
      pepExtras,
      'pyproject.toml',
      '[project]\ndependencies = ["fastapi[standard]>=0.115.0", "posthog>=7.40.0,<8"]\n',
    );
    expect(declaredSdkMajor(pepExtras, 'python')).toBe('7');

    // Hashed requirements with backslash continuations strip flags cleanly.
    const reqHashed = makeDir('py-req-hash-');
    writeFile(
      reqHashed,
      'requirements.txt',
      'posthog==7.40.0 \\\n    --hash=sha256:deadbeef\n',
    );
    expect(declaredSdkMajor(reqHashed, 'python')).toBe('7');

    // Unpinned hashed requirements fall through to pyproject.toml.
    const reqFallback = makeDir('py-req-fallback-');
    writeFile(
      reqFallback,
      'requirements.txt',
      'posthog --hash=sha256:deadbeef\n',
    );
    writeFile(
      reqFallback,
      'pyproject.toml',
      '[project]\ndependencies = ["posthog>=7.40.0,<8"]\n',
    );
    expect(declaredSdkMajor(reqFallback, 'python')).toBe('7');

    // go.mod skips // indirect, exclude, and replace entries while detecting multi-line require blocks.
    const goIndirect = makeDir('go-indirect-');
    writeFile(
      goIndirect,
      'go.mod',
      [
        'module example.com/app',
        'require (',
        '\tgithub.com/posthog/posthog-go v1.6.14 // indirect',
        ')',
        'exclude github.com/posthog/posthog-go v1.5.0',
      ].join('\n'),
    );
    expect(declaredSdkMajor(goIndirect, 'go')).toBeUndefined();

    const goMultiRequire = makeDir('go-multi-req-');
    writeFile(
      goMultiRequire,
      'go.mod',
      [
        'module example.com/app',
        'require (',
        '\tgithub.com/posthog/posthog-go v1.6.14',
        ')',
      ].join('\n'),
    );
    expect(declaredSdkMajor(goMultiRequire, 'go')).toBe('1');

    // Non-[project] pyproject.toml tables must not trigger PEP 621 detection.
    const noProjectToml = makeDir('py-no-project-');
    writeFile(
      noProjectToml,
      'pyproject.toml',
      '[tool.other]\ndependencies = ["posthog>=7.40.0,<8"]\n',
    );
    expect(declaredSdkMajor(noProjectToml, 'python')).toBeUndefined();

    // Root Cargo.toml that is both a package and a workspace resolves its own workspace.dependencies.
    const rustRootWs = makeDir('rust-root-ws-');
    writeFile(
      rustRootWs,
      'Cargo.toml',
      '[package]\nname = "app"\n[dependencies]\nposthog-rs = { workspace = true }\n[workspace]\nmembers = []\n[workspace.dependencies]\nposthog-rs = "0.33.1"\n',
    );
    expect(declaredSdkMajor(rustRootWs, 'rust')).toBe('0');

    // Comment-less pbxproj XCRemoteSwiftPackageReference block works via isa fallback.
    const pbxIsa = makeDir('ios-pbx-isa-');
    writeFile(
      pbxIsa,
      'App.xcodeproj/project.pbxproj',
      '{\n  isa = XCRemoteSwiftPackageReference;\n  repositoryURL = "https://github.com/PostHog/posthog-ios.git";\n  requirement = {\n    kind = upToNextMajorVersion;\n    minimumVersion = 4.1.0;\n  };\n}\n',
    );
    expect(declaredSdkMajor(pbxIsa, 'ios')).toBe('4');

    // Commented-out .package() lines in Package.swift must not hijack or break detection.
    const swiftComments = makeDir('ios-spm-comments-');
    writeFile(
      swiftComments,
      'Package.swift',
      [
        '// .package(url: "https://github.com/PostHog/posthog-ios.git", from: "4.0.0")',
        '/* .package(url: "https://github.com/PostHog/posthog-ios.git", ( */',
        '.package(url: "https://github.com/PostHog/posthog-ios.git", from: "3.14.0")',
      ].join('\n'),
    );
    expect(declaredSdkMajor(swiftComments, 'ios')).toBe('3');

    // Adversarial inputs across project.yml, Package.swift, pbxproj, requirements.txt, Podfile, Podfile.lock, pubspec.yaml, and Gradle run linearly.
    const redosDir = makeDir('ios-redos-');
    writeFile(
      redosDir,
      'project.yml',
      `packages:\n  PostHog:\n${' '.repeat(40_000)}`,
    );
    writeFile(
      redosDir,
      'Package.swift',
      `${'.package(url: "https://github.com/PostHog/posthog-ios", '.repeat(
        500,
      )}${'a'.repeat(10_000)}`,
    );
    writeFile(
      redosDir,
      'App.xcodeproj/project.pbxproj',
      `{}${'XCRemoteSwiftPackageReference;'.repeat(
        1_500,
      )}\n{ isa = XCRemoteSwiftPackageReference; ${'repositoryURL='.repeat(
        1_500,
      )} }`,
    );
    writeFile(redosDir, 'requirements.txt', `posthog${' '.repeat(40_000)}!\n`);
    writeFile(redosDir, 'Podfile', `${'\n'.repeat(40_000)}pod 'Other'\n`);
    writeFile(
      redosDir,
      'Podfile.lock',
      `${'\n'.repeat(40_000)}  - Other (1.0)\n`,
    );
    writeFile(redosDir, 'pubspec.yaml', `${'\n'.repeat(40_000)}other: 1.0.0\n`);
    const bigCatalog = [
      '[versions]',
      'ph = "3.8.0"',
      '[libraries]',
      ...Array.from(
        { length: 400 },
        (_, i) =>
          `ph-${i} = { group = "com.posthog", name = "posthog-android", version.ref = "ph" }`,
      ),
    ].join('\n');
    writeFile(redosDir, 'gradle/libs.versions.toml', bigCatalog);
    writeFile(
      redosDir,
      'build.gradle.kts',
      `dependencies { implementation(libs.other.lib) }\n${'// pad\n'.repeat(
        2_000,
      )}`,
    );
    const t0 = performance.now();
    expect(declaredSdkMajor(redosDir, 'ios')).toBeUndefined();
    expect(declaredSdkMajor(redosDir, 'python')).toBeUndefined();
    expect(declaredSdkMajor(redosDir, 'flutter')).toBeUndefined();
    expect(declaredSdkMajor(redosDir, 'android')).toBeUndefined();
    expect(performance.now() - t0).toBeLessThan(200);

    // xcodeProjDirs caps matched .xcodeproj bundles at 8 regardless of filesystem entry order.
    const manyXcode = makeDir('ios-many-xcode-');
    for (let i = 0; i < 12; i++) {
      writeFile(manyXcode, `App${i}.xcodeproj/project.pbxproj`, '{}');
    }
    const pbxReadSpy = vi.spyOn(fs, 'readFileSync');
    expect(declaredSdkMajor(manyXcode, 'ios')).toBeUndefined();
    const pbxReads = pbxReadSpy.mock.calls.filter((c) =>
      String(c[0]).endsWith('project.pbxproj'),
    );
    expect(pbxReads).toHaveLength(8);
    pbxReadSpy.mockRestore();

    // Gradle catalog supports [libraries] before [versions] and [bundles] aliases.
    const gradleOrderBundle = makeDir('gradle-order-bundle-');
    writeFile(
      gradleOrderBundle,
      'gradle/libs.versions.toml',
      [
        '[libraries]',
        'posthog-android = { group = "com.posthog", name = "posthog-android", version.ref = "ph" }',
        '[bundles]',
        'analytics = ["posthog-android"]',
        '[versions]',
        'ph = "3.9.0"',
      ].join('\n'),
    );
    writeFile(
      gradleOrderBundle,
      'app/build.gradle.kts',
      'dependencies { implementation(libs.bundles.analytics) }\n',
    );
    expect(declaredSdkMajor(gradleOrderBundle, 'android')).toBe('3');

    const nestedSpmDir = makeDir('ios-spm-nested-');
    writeFile(
      nestedSpmDir,
      'Package.swift',
      '.package(url: "https://github.com/PostHog/posthog-ios.git", .upToNextMajor(from: "4.2.0"))',
    );
    expect(declaredSdkMajor(nestedSpmDir, 'ios')).toBe('4');

    // Workspace Gradle catalogs must not bleed into non-Gradle or non-PostHog siblings.
    const polyglot = makeDir('polyglot-gradle-');
    writeFile(
      polyglot,
      'gradle/libs.versions.toml',
      '[versions]\nposthogAndroid = "3.8.0"\nposthogKmp = "0.5.0"\n[libraries]\nposthog-android = { group = "com.posthog", name = "posthog-android", version.ref = "posthogAndroid" }\nposthog-kmp = { group = "com.posthog", name = "posthog-kmp", version.ref = "posthogKmp" }\n',
    );
    writeFile(
      polyglot,
      'apps/web/package.json',
      JSON.stringify({ dependencies: { next: '15.0.0' } }),
    );
    writeFile(
      polyglot,
      'apps/jvm/build.gradle.kts',
      'dependencies { implementation("io.ktor:ktor-server-core:2.0.0") }\n',
    );
    writeFile(
      polyglot,
      'apps/mobile/app/build.gradle.kts',
      'dependencies { implementation(libs.posthog.android) }\n',
    );
    expect(
      declaredSdkMajor(path.join(polyglot, 'apps/web'), 'android', polyglot),
    ).toBeUndefined();
    expect(
      declaredSdkMajor(path.join(polyglot, 'apps/web'), 'kmp', polyglot),
    ).toBeUndefined();
    expect(
      declaredSdkMajor(path.join(polyglot, 'apps/jvm'), 'android', polyglot),
    ).toBeUndefined();
    expect(
      declaredSdkMajor(path.join(polyglot, 'apps/mobile'), 'android', polyglot),
    ).toBe('3');
    expect(
      declaredSdkMajor(path.join(polyglot, 'apps/mobile'), 'kmp', polyglot),
    ).toBeUndefined();
  });

  it('resolves workspace-root Cargo deps when discovery.mode is off and ignores symlinked manifests outside root', () => {
    const ws = makeDir('ws-mode-off-');
    writeFile(
      ws,
      'Cargo.toml',
      '[workspace]\nmembers = ["crates/*"]\n[workspace.dependencies]\nposthog-rs = "0.33.1"\n',
    );
    writeFile(
      ws,
      'crates/api/Cargo.toml',
      '[dependencies]\nposthog-rs = { workspace = true }\n',
    );

    const memberDir = path.join(ws, 'crates/api');
    const discoveryOff: Discovery = {
      program: 'posthog-integration',
      discoveredAt: '2026-11-24T00:00:00.000Z',
      rootDir: memberDir,
      runDir: memberDir,
      runProject: '.',
      mode: 'off',
      files: {
        dir: memberDir,
        files: [],
        manifests: [],
        lockfiles: [],
        envKeys: [],
        workspaceMarkers: [],
        scriptHosts: [],
        complete: true,
        truncated: false,
      },
      tools: { tools: [], complete: true },
      projects: {
        repoType: 'single',
        workspaces: [],
        projects: [{ path: '.', traits: {} }],
        complete: true,
      },
      detected: {},
    };
    const offSession = buildSession({ installDir: memberDir });
    offSession.frameworkContext = {
      [DISCOVERY_KEY]: discoveryOff,
      [VERSIONED_SDK_SKILLS_ENABLED_KEY]: true,
    };
    expect(getTraits(offSession, '.').sdkRust).toBe('0');

    // Scoped sub-run launched from the workspace root with discovery.mode === 'off' still resolves root Cargo.toml.
    const rootOffDiscovery: Discovery = {
      ...discoveryOff,
      rootDir: ws,
      runDir: ws,
    };
    const scopedFromRoot = buildSession({ installDir: memberDir });
    scopedFromRoot.frameworkContext = {
      [DISCOVERY_KEY]: rootOffDiscovery,
      [VERSIONED_SDK_SKILLS_ENABLED_KEY]: true,
    };
    expect(getTraits(scopedFromRoot, '.').sdkRust).toBe('0');

    const noDiscoverySession = buildSession({ installDir: memberDir });
    noDiscoverySession.frameworkContext = {
      [VERSIONED_SDK_SKILLS_ENABLED_KEY]: true,
    };
    expect(getTraits(noDiscoverySession, '.').sdkRust).toBe('0');

    // Shallow-cloned sessions without discovery still reuse the frameworkContext memoization cache.
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const clonedNoDiscovery = { ...noDiscoverySession };
    expect(getTraits(clonedNoDiscovery, '.').sdkRust).toBe('0');
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();

    // Symlinked root checkout directories are allowed while symlinked manifests escaping root are rejected.
    const realRepo = makeDir('real-py-repo-');
    writeFile(realRepo, 'requirements.txt', 'posthog==7.40.0\n');
    const linkParent = makeDir('sym-root-parent-');
    const symRoot = path.join(linkParent, 'linked-checkout');
    fs.symlinkSync(realRepo, symRoot);
    expect(declaredSdkMajor(symRoot, 'python')).toBe('7');

    // Symlinked manifests pointing outside the root must be ignored.
    const outside = makeDir('outside-secret-');
    writeFile(
      outside,
      'pyproject.toml',
      '[project]\ndependencies = ["posthog>=7.0.0,<8"]\n',
    );
    const symRepo = makeDir('sym-repo-');
    fs.symlinkSync(
      path.join(outside, 'pyproject.toml'),
      path.join(symRepo, 'pyproject.toml'),
    );
    expect(declaredSdkMajor(symRepo, 'python')).toBeUndefined();
  });

  it('memoizes SDK trait scans per discovery walk and ties all eight TRAITS.sdk* entries to posthogInstalled', () => {
    const ws = makeDir('all-eight-sdks-');
    writeFile(ws, 'pnpm-workspace.yaml', 'packages:\n  - "apps/*"\n');
    writeFile(ws, 'apps/py/requirements.txt', 'posthog==7.40.0\n');
    writeFile(
      ws,
      'apps/node/package.json',
      JSON.stringify({ dependencies: { 'posthog-node': '^5.10.0' } }),
    );
    writeFile(
      ws,
      'apps/go/go.mod',
      'module x\nrequire github.com/posthog/posthog-go v1.6.14\n',
    );
    writeFile(
      ws,
      'apps/rust/Cargo.toml',
      '[dependencies]\nposthog-rs = "0.33"\n',
    );
    writeFile(ws, 'apps/ios/Podfile', "pod 'PostHog', '~> 3.0'\n");
    writeFile(
      ws,
      'apps/android/app/build.gradle.kts',
      'implementation("com.posthog:posthog-android:3.14.0")\n',
    );
    writeFile(
      ws,
      'apps/flutter/pubspec.yaml',
      'dependencies:\n  posthog_flutter: ^5.0.0\n',
    );
    writeFile(
      ws,
      'apps/kmp/shared/build.gradle.kts',
      'implementation("com.posthog:posthog-kmp:0.5.0")\n',
    );

    const walk = walkRepoFiles(ws, { runProject: 'apps/py' });
    const projects = discoverProjects(walk.files, 'apps/py');
    const discovery: Discovery = {
      program: 'posthog-integration',
      discoveredAt: '2026-11-24T00:00:00.000Z',
      rootDir: ws,
      runDir: path.join(ws, 'apps/py'),
      runProject: 'apps/py',
      mode: 'one-project',
      files: walk.files,
      tools: { tools: [], complete: true },
      projects,
      detected: {},
    };
    const session = buildSession({ installDir: path.join(ws, 'apps/py') });
    session.runProject = 'apps/py';
    session.frameworkContext = {
      [DISCOVERY_KEY]: discovery,
      [VERSIONED_SDK_SKILLS_ENABLED_KEY]: true,
    };

    const expected: Record<string, [string, string]> = {
      'apps/py': ['sdkPython', '7'],
      'apps/node': ['sdkNode', '5'],
      'apps/go': ['sdkGo', '1'],
      'apps/rust': ['sdkRust', '0'],
      'apps/ios': ['sdkIos', '3'],
      'apps/android/app': ['sdkAndroid', '3'],
      'apps/flutter': ['sdkFlutter', '5'],
      'apps/kmp/shared': ['sdkKmp', '0'],
    };
    const seenSdkTraits: string[] = [];
    for (const [proj, [trait, major]] of Object.entries(expected)) {
      const traits = getTraits(session, proj);
      expect(traits[trait as keyof typeof traits]).toBe(major);
      expect(traits.posthogInstalled).toBe('yes');
      seenSdkTraits.push(trait);
    }
    const registrySdkTraits = Object.keys(TRAITS)
      .filter((k) => k.startsWith('sdk'))
      .sort();
    expect(seenSdkTraits.sort()).toEqual(registrySdkTraits);

    // Mutating requirements.txt mid-run does not trigger another sync scan on the same Discovery walk.
    const readSpy = vi.spyOn(fs, 'readFileSync');
    writeFile(ws, 'apps/py/requirements.txt', 'posthog==8.0.0\n');
    readSpy.mockClear();
    expect(getTraits(session, 'apps/py').sdkPython).toBe('7');
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();

    // Shared Gradle catalog cache parses libs.versions.toml once across Android and KMP scans in one walk.
    const gradleWs = makeDir('gradle-cache-walk-');
    writeFile(
      gradleWs,
      'gradle/libs.versions.toml',
      '[versions]\nph = "3.8.0"\nkmp = "0.5.0"\n[libraries]\nposthog-android = { group = "com.posthog", name = "posthog-android", version.ref = "ph" }\nposthog-kmp = { group = "com.posthog", name = "posthog-kmp", version.ref = "kmp" }\n',
    );
    writeFile(
      gradleWs,
      'app/build.gradle.kts',
      'dependencies { implementation(libs.posthog.android) }\n',
    );
    writeFile(
      gradleWs,
      'shared/build.gradle.kts',
      'dependencies { implementation(libs.posthog.kmp) }\n',
    );
    const catalogCache = new Map();
    const catReadSpy = vi.spyOn(fs, 'readFileSync');
    expect(declaredSdkMajor(gradleWs, 'android', undefined, catalogCache)).toBe(
      '3',
    );
    expect(declaredSdkMajor(gradleWs, 'kmp', undefined, catalogCache)).toBe(
      '0',
    );
    const tomlReads = catReadSpy.mock.calls.filter((c) =>
      String(c[0]).endsWith('libs.versions.toml'),
    );
    expect(tomlReads).toHaveLength(1);
    catReadSpy.mockRestore();
  });
});
