import { readInstalledSdks } from '@services/detection/sdk-install';
import { withProject } from './helpers.no-jest';

describe('readInstalledSdks: npm (posthog-node)', () => {
  it('reads every copy from package-lock.json, nested wrapper copies included', async () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { 'posthog-node': '^6.0.0' } },
        'node_modules/posthog-node': { version: '6.0.1' },
        'node_modules/@posthog/nuxt/node_modules/posthog-node': {
          version: '5.60.0',
        },
      },
    };
    const copies = await withProject(
      {
        'package.json': JSON.stringify({
          dependencies: { 'posthog-node': '^6.0.0' },
        }),
        'package-lock.json': JSON.stringify(lock),
      },
      (dir) => readInstalledSdks(dir, 'posthog-node'),
    );
    expect(copies).toEqual([
      {
        major: 6,
        version: '6.0.1',
        source: 'package-lock.json (node_modules/posthog-node)',
      },
      {
        major: 5,
        version: '5.60.0',
        source:
          'package-lock.json (node_modules/@posthog/nuxt/node_modules/posthog-node)',
      },
    ]);
  });

  it('reads a lockfile v1 dependency tree', async () => {
    const lock = {
      lockfileVersion: 1,
      dependencies: {
        '@posthog/nuxt': {
          version: '1.9.0',
          dependencies: { 'posthog-node': { version: '5.58.0' } },
        },
      },
    };
    const copies = await withProject(
      { 'package-lock.json': JSON.stringify(lock) },
      (dir) => readInstalledSdks(dir, 'posthog-node'),
    );
    expect(copies).toEqual([
      {
        major: 5,
        version: '5.58.0',
        source: 'package-lock.json (@posthog/nuxt)',
      },
    ]);
  });

  it('reads pnpm-lock.yaml package keys in both spellings', async () => {
    const lock = [
      'lockfileVersion: 9.0',
      'importers:',
      '  .:',
      '    dependencies:',
      '      posthog-node:',
      '        specifier: ^5.60.0',
      '        version: 5.60.0',
      'packages:',
      '  posthog-node@5.60.0:',
      '    resolution: {integrity: sha512-x}',
      "  '/posthog-node@5.61.2':",
      '    resolution: {integrity: sha512-y}',
      '  posthog-node-extra@1.0.0:',
      '    resolution: {integrity: sha512-z}',
      'snapshots:',
      '  posthog-node@5.60.0(zod@3.25.76):',
      '    dependencies: {}',
    ].join('\n');
    const copies = await withProject({ 'pnpm-lock.yaml': lock }, (dir) =>
      readInstalledSdks(dir, 'posthog-node'),
    );
    expect(copies.map((c) => c.version)).toEqual(['5.60.0', '5.61.2']);
    expect(copies.every((c) => c.source === 'pnpm-lock.yaml')).toBe(true);
  });

  it('reads classic and berry yarn.lock blocks', async () => {
    const classic = [
      '# yarn lockfile v1',
      '',
      'posthog-node@^5.60.0, posthog-node@^5.0.0:',
      '  version "5.61.2"',
      '  resolved "https://registry.yarnpkg.com/posthog-node/-/posthog-node-5.61.2.tgz"',
      '',
      '"@posthog/ai@^8.0.0":',
      '  version "8.18.2"',
    ].join('\n');
    const berry = [
      '"posthog-node@npm:^6.0.0":',
      '  version: 6.0.1',
      '  resolution: "posthog-node@npm:6.0.1"',
      '',
      '"posthog-js@npm:^1.0.0":',
      '  version: 1.444.4',
    ].join('\n');
    expect(
      await withProject({ 'yarn.lock': classic }, (dir) =>
        readInstalledSdks(dir, 'posthog-node'),
      ),
    ).toEqual([{ major: 5, version: '5.61.2', source: 'yarn.lock' }]);
    expect(
      await withProject({ 'yarn.lock': berry }, (dir) =>
        readInstalledSdks(dir, 'posthog-node'),
      ),
    ).toEqual([{ major: 6, version: '6.0.1', source: 'yarn.lock' }]);
  });

  it('reads the text bun.lock', async () => {
    const lock = `{
  "lockfileVersion": 1,
  "packages": {
    "posthog-node": ["posthog-node@5.61.2", "", { "dependencies": {} }, "sha512-x"],
    "posthog-js": ["posthog-js@1.444.4", "", {}, "sha512-y"],
  }
}`;
    expect(
      await withProject({ 'bun.lock': lock }, (dir) =>
        readInstalledSdks(dir, 'posthog-node'),
      ),
    ).toEqual([{ major: 5, version: '5.61.2', source: 'bun.lock' }]);
  });

  it('falls back to the package.json range when no lockfile names the package', async () => {
    const files = {
      'package.json': JSON.stringify({
        devDependencies: { 'posthog-node': '^5.60.0' },
      }),
      'pnpm-lock.yaml': 'lockfileVersion: 9.0\npackages: {}\n',
    };
    expect(
      await withProject(files, (dir) => readInstalledSdks(dir, 'posthog-node')),
    ).toEqual([{ major: 5, version: '^5.60.0', source: 'package.json' }]);
  });

  it('finds nothing for a project without the package or a git requirement', async () => {
    expect(
      await withProject(
        {
          'package.json': JSON.stringify({
            dependencies: { 'posthog-js': '^1.0.0' },
          }),
        },
        (dir) => readInstalledSdks(dir, 'posthog-node'),
      ),
    ).toEqual([]);
    expect(
      await withProject(
        {
          'package.json': JSON.stringify({
            dependencies: { 'posthog-node': 'github:PostHog/posthog-js#main' },
          }),
        },
        (dir) => readInstalledSdks(dir, 'posthog-node'),
      ),
    ).toEqual([]);
  });
});

describe('readInstalledSdks: PyPI (posthog)', () => {
  const tomlLock = (version: string) =>
    [
      'version = 1',
      '',
      '[[package]]',
      'name = "posthog-extra"',
      'version = "1.0.0"',
      '',
      '[[package]]',
      'name = "posthog"',
      `version = "${version}"`,
      'source = { registry = "https://pypi.org/simple" }',
      '',
    ].join('\n');

  it.each([['uv.lock'], ['poetry.lock'], ['pdm.lock']])(
    'reads the resolved version from %s',
    async (file) => {
      expect(
        await withProject(
          { [file]: tomlLock('7.82.1'), 'requirements.txt': 'posthog>=3\n' },
          (dir) => readInstalledSdks(dir, 'posthog-python'),
        ),
      ).toEqual([{ major: 7, version: '7.82.1', source: file }]);
    },
  );

  it('reads Pipfile.lock', async () => {
    const lock = JSON.stringify({
      default: { posthog: { version: '==7.82.1' } },
      develop: {},
    });
    expect(
      await withProject({ 'Pipfile.lock': lock }, (dir) =>
        readInstalledSdks(dir, 'posthog-python'),
      ),
    ).toEqual([{ major: 7, version: '==7.82.1', source: 'Pipfile.lock' }]);
  });

  it('reads pyproject.toml in PEP 621 and poetry forms', async () => {
    const pep621 = [
      '[project]',
      'dependencies = [',
      '  "fastapi>=0.115",',
      '  "posthog[flags]>=7,<8",',
      ']',
    ].join('\n');
    const poetry = [
      '[tool.poetry.dependencies]',
      'python = "^3.10"',
      'posthog = "^3.0"',
    ].join('\n');
    expect(
      await withProject({ 'pyproject.toml': pep621 }, (dir) =>
        readInstalledSdks(dir, 'posthog-python'),
      ),
    ).toEqual([{ major: 7, version: '>=7,<8', source: 'pyproject.toml' }]);
    expect(
      await withProject({ 'pyproject.toml': poetry }, (dir) =>
        readInstalledSdks(dir, 'posthog-python'),
      ),
    ).toEqual([{ major: 3, version: '^3.0', source: 'pyproject.toml' }]);
  });

  it('reads requirements files and Pipfile, and skips a bare name', async () => {
    const files = {
      'requirements.txt': 'django>=4\nposthog>=3.0.0\nposthoganalytics>=7\n',
      'requirements-dev.txt': 'posthog\n',
      Pipfile: '[packages]\nposthog = ">=7"\n',
    };
    expect(
      await withProject(files, (dir) =>
        readInstalledSdks(dir, 'posthog-python'),
      ),
    ).toEqual([
      { major: 7, version: '>=7', source: 'Pipfile' },
      { major: 3, version: '>=3.0.0', source: 'requirements.txt' },
    ]);
  });
});

describe('readInstalledSdks: Go', () => {
  it('reads direct requirements of either module path and skips indirect ones', async () => {
    const gomod = [
      'module example.com/app',
      '',
      'go 1.22',
      '',
      'require (',
      '\tgithub.com/posthog/posthog-go v1.39.0',
      '\tgithub.com/posthog/posthog-go/v2 v2.0.0',
      '\tgithub.com/google/uuid v1.6.0 // indirect',
      ')',
      '',
      'require github.com/posthog/posthog-go/otel/v2 v2.0.0 // indirect',
    ].join('\n');
    expect(
      await withProject({ 'go.mod': gomod }, (dir) =>
        readInstalledSdks(dir, 'posthog-go'),
      ),
    ).toEqual([
      {
        major: 1,
        version: 'github.com/posthog/posthog-go v1.39.0',
        source: 'go.mod',
      },
      {
        major: 2,
        version: 'github.com/posthog/posthog-go/v2 v2.0.0',
        source: 'go.mod',
      },
    ]);
  });

  it('reads a single-line requirement', async () => {
    expect(
      await withProject(
        {
          'go.mod':
            'module example.com/app\n\ngo 1.21\n\nrequire github.com/posthog/posthog-go v1.2.3\n',
        },
        (dir) => readInstalledSdks(dir, 'posthog-go'),
      ),
    ).toEqual([
      {
        major: 1,
        version: 'github.com/posthog/posthog-go v1.2.3',
        source: 'go.mod',
      },
    ]);
  });
});

describe('readInstalledSdks: Cargo', () => {
  it('prefers Cargo.lock and reads a 0.x crate as major 0', async () => {
    const lock = [
      '[[package]]',
      'name = "posthog-rs"',
      'version = "0.30.0"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
      '',
      '[[package]]',
      'name = "serde"',
      'version = "1.0.219"',
    ].join('\n');
    expect(
      await withProject(
        {
          'Cargo.lock': lock,
          'Cargo.toml': '[dependencies]\nposthog-rs = "1"\n',
        },
        (dir) => readInstalledSdks(dir, 'posthog-rs'),
      ),
    ).toEqual([{ major: 0, version: '0.30.0', source: 'Cargo.lock' }]);
  });

  it('reads the three Cargo.toml spellings', async () => {
    const manifest = [
      '[dependencies]',
      'posthog-rs = { version = "1", default-features = false, features = ["tls"] }',
      '',
      '[dev-dependencies]',
      'posthog-rs = "0.30"',
      '',
      '[target."cfg(unix)".dependencies.posthog-rs]',
      'version = "1.0"',
    ].join('\n');
    const copies = await withProject({ 'Cargo.toml': manifest }, (dir) =>
      readInstalledSdks(dir, 'posthog-rs'),
    );
    expect(copies.map((c) => [c.major, c.version])).toEqual([
      [1, '1'],
      [0, '0.30'],
      [1, '1.0'],
    ]);
  });
});

describe('readInstalledSdks: pub', () => {
  it('reads pubspec.lock before pubspec.yaml', async () => {
    const lock = [
      'packages:',
      '  posthog_flutter:',
      '    dependency: "direct main"',
      '    description:',
      '      name: posthog_flutter',
      '      url: "https://pub.dev"',
      '    source: hosted',
      '    version: "5.58.4"',
      '  path:',
      '    dependency: transitive',
      '    version: "1.9.0"',
    ].join('\n');
    expect(
      await withProject(
        {
          'pubspec.lock': lock,
          'pubspec.yaml': 'dependencies:\n  posthog_flutter: ^6.0.0\n',
        },
        (dir) => readInstalledSdks(dir, 'posthog-flutter'),
      ),
    ).toEqual([{ major: 5, version: '5.58.4', source: 'pubspec.lock' }]);
  });

  it('reads the pubspec.yaml constraint and skips a git source', async () => {
    expect(
      await withProject(
        {
          'pubspec.yaml':
            'dependencies:\n  flutter:\n    sdk: flutter\n  posthog_flutter: ^5.58.4\n',
        },
        (dir) => readInstalledSdks(dir, 'posthog-flutter'),
      ),
    ).toEqual([{ major: 5, version: '^5.58.4', source: 'pubspec.yaml' }]);
    expect(
      await withProject(
        {
          'pubspec.yaml':
            'dependencies:\n  posthog_flutter:\n    git:\n      url: https://github.com/PostHog/posthog-flutter\n',
        },
        (dir) => readInstalledSdks(dir, 'posthog-flutter'),
      ),
    ).toEqual([]);
  });
});

describe('readInstalledSdks: Swift Package Manager and CocoaPods', () => {
  it('reads the workspace Package.resolved pin (v2 shape)', async () => {
    const resolved = JSON.stringify({
      pins: [
        {
          identity: 'posthog-ios',
          kind: 'remoteSourceControl',
          location: 'https://github.com/PostHog/posthog-ios',
          state: { revision: 'abc', version: '3.93.2' },
        },
      ],
      version: 2,
    });
    const file =
      'App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved';
    expect(
      await withProject({ [file]: resolved }, (dir) =>
        readInstalledSdks(dir, 'posthog-ios'),
      ),
    ).toEqual([{ major: 3, version: '3.93.2', source: file }]);
  });

  it('reads the v1 Package.resolved shape', async () => {
    const resolved = JSON.stringify({
      object: {
        pins: [
          {
            package: 'PostHog',
            repositoryURL: 'https://github.com/PostHog/posthog-ios.git',
            state: { version: '3.1.0' },
          },
        ],
      },
      version: 1,
    });
    expect(
      await withProject({ 'Package.resolved': resolved }, (dir) =>
        readInstalledSdks(dir, 'posthog-ios'),
      ),
    ).toEqual([{ major: 3, version: '3.1.0', source: 'Package.resolved' }]);
  });

  it('reads the pbxproj package reference when nothing is resolved yet', async () => {
    const pbxproj = [
      '/* Begin XCRemoteSwiftPackageReference section */',
      '\t\tAB12 /* XCRemoteSwiftPackageReference "posthog-ios" */ = {',
      '\t\t\tisa = XCRemoteSwiftPackageReference;',
      '\t\t\trepositoryURL = "https://github.com/PostHog/posthog-ios";',
      '\t\t\trequirement = {',
      '\t\t\t\tkind = upToNextMajorVersion;',
      '\t\t\t\tminimumVersion = 3.0.0;',
      '\t\t\t};',
      '\t\t};',
      '/* End XCRemoteSwiftPackageReference section */',
    ].join('\n');
    expect(
      await withProject({ 'App.xcodeproj/project.pbxproj': pbxproj }, (dir) =>
        readInstalledSdks(dir, 'posthog-ios'),
      ),
    ).toEqual([
      { major: 3, version: '3.0.0', source: 'App.xcodeproj/project.pbxproj' },
    ]);
  });

  it('reads an XcodeGen project.yml package', async () => {
    const yml = [
      'name: App',
      'packages:',
      '  PostHog:',
      '    url: https://github.com/PostHog/posthog-ios',
      '    from: 3.2.0',
    ].join('\n');
    expect(
      await withProject({ 'project.yml': yml }, (dir) =>
        readInstalledSdks(dir, 'posthog-ios'),
      ),
    ).toEqual([{ major: 3, version: 'from: 3.2.0', source: 'project.yml' }]);
  });

  it('reads CocoaPods, and treats a bare pod as the last 3.x', async () => {
    expect(
      await withProject(
        {
          'Podfile.lock':
            'PODS:\n  - PostHog (3.93.2)\n\nDEPENDENCIES:\n  - PostHog\n',
        },
        (dir) => readInstalledSdks(dir, 'posthog-ios'),
      ),
    ).toEqual([{ major: 3, version: '3.93.2', source: 'Podfile.lock' }]);
    expect(
      await withProject(
        {
          Podfile:
            "platform :ios, '13.0'\ntarget 'App' do\n  pod 'PostHog'\nend\n",
        },
        (dir) => readInstalledSdks(dir, 'posthog-ios'),
      ),
    ).toEqual([{ major: 3, version: 'pod PostHog', source: 'Podfile' }]);
  });

  it('reports both an SPM pin and a pod when a project carries both', async () => {
    const resolved = JSON.stringify({
      pins: [
        {
          identity: 'posthog-ios',
          location: 'https://github.com/PostHog/posthog-ios',
          state: { version: '4.0.0' },
        },
      ],
      version: 3,
    });
    const copies = await withProject(
      { 'Package.resolved': resolved, Podfile: "pod 'PostHog', '~> 3.0'\n" },
      (dir) => readInstalledSdks(dir, 'posthog-ios'),
    );
    expect(copies.map((c) => [c.major, c.source])).toEqual([
      [4, 'Package.resolved'],
      [3, 'Podfile'],
    ]);
  });
});

describe('readInstalledSdks: Gradle', () => {
  it('reads the version catalog through a version.ref', async () => {
    const catalog = [
      '[versions]',
      'posthog = "3.75.0"',
      '',
      '[libraries]',
      'posthog-android = { module = "com.posthog:posthog-android", version.ref = "posthog" }',
      'okhttp = { group = "com.squareup.okhttp3", name = "okhttp", version = "4.12.0" }',
    ].join('\n');
    expect(
      await withProject({ 'gradle/libs.versions.toml': catalog }, (dir) =>
        readInstalledSdks(dir, 'posthog-android'),
      ),
    ).toEqual([
      { major: 3, version: '3.75.0', source: 'gradle/libs.versions.toml' },
    ]);
  });

  it('reads module scripts in Groovy and Kotlin, dynamic versions included', async () => {
    const files = {
      'build.gradle':
        'plugins { id "com.android.application" version "8.5.0" apply false }\n',
      'app/build.gradle.kts':
        'dependencies {\n    implementation("com.posthog:posthog-android:3.+")\n}\n',
      'lib/build.gradle':
        "dependencies {\n    implementation 'com.posthog:posthog-android:3.75.0'\n}\n",
    };
    const copies = await withProject(files, (dir) =>
      readInstalledSdks(dir, 'posthog-android'),
    );
    expect(copies).toEqual([
      { major: 3, version: '3.+', source: 'app/build.gradle.kts' },
      { major: 3, version: '3.75.0', source: 'lib/build.gradle' },
    ]);
  });
});
