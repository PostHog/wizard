import { checkSdkFloor } from '@services/detection/sdk-floors';
import { withProject } from '@services/detection/sdk-install/__tests__/helpers.no-jest';

const floor = (
  files: Record<string, string>,
  sdk: Parameters<typeof checkSdkFloor>[1],
) => withProject(files, (dir) => checkSdkFloor(dir, sdk));

describe('checkSdkFloor', () => {
  it('passes an empty project for every SDK: unknown is not a failure', async () => {
    for (const sdk of [
      'posthog-python',
      'posthog-node',
      'posthog-go',
      'posthog-rs',
      'posthog-ios',
      'posthog-android',
      'posthog-flutter',
    ] as const) {
      expect(await floor({}, sdk)).toEqual({ ok: true });
    }
  });

  describe('Python 3.10', () => {
    it.each([
      ['requires-python = ">=3.10"', true],
      ['requires-python = ">=3.9,<4"', false],
      ['requires-python = "~=3.12"', true],
    ])('pyproject %s', async (line, ok) => {
      const check = await floor(
        { 'pyproject.toml': `[project]\n${line}\n` },
        'posthog-python',
      );
      expect(check.ok).toBe(ok);
      if (!check.ok)
        expect(check.reason).toBe('requires-python 3.9 is below 3.10');
    });

    it('reads .python-version when pyproject sets no requirement', async () => {
      expect(
        await floor({ '.python-version': '3.9.18\n' }, 'posthog-python'),
      ).toEqual({
        ok: false,
        reason: '.python-version 3.9 is below 3.10',
      });
      expect(
        (await floor({ '.python-version': '3.12\n' }, 'posthog-python')).ok,
      ).toBe(true);
    });
  });

  it('Go 1.21: reads the go directive', async () => {
    expect(
      await floor({ 'go.mod': 'module app\n\ngo 1.20\n' }, 'posthog-go'),
    ).toEqual({
      ok: false,
      reason: 'go.mod go directive 1.20 is below 1.21',
    });
    expect(
      (await floor({ 'go.mod': 'module app\n\ngo 1.22.1\n' }, 'posthog-go')).ok,
    ).toBe(true);
  });

  describe('Rust 1.78', () => {
    it('reads rust-version and a numeric toolchain channel, and passes named channels', async () => {
      expect(
        await floor(
          { 'Cargo.toml': '[package]\nrust-version = "1.75"\n' },
          'posthog-rs',
        ),
      ).toEqual({
        ok: false,
        reason: 'rust-version 1.75 is below 1.78',
      });
      expect(
        await floor(
          { 'rust-toolchain.toml': '[toolchain]\nchannel = "1.77.0"\n' },
          'posthog-rs',
        ),
      ).toEqual({
        ok: false,
        reason: 'rust-toolchain channel 1.77 is below 1.78',
      });
      expect(
        (
          await floor(
            { 'rust-toolchain.toml': '[toolchain]\nchannel = "stable"\n' },
            'posthog-rs',
          )
        ).ok,
      ).toBe(true);
      expect(
        (
          await floor(
            { 'Cargo.toml': '[package]\nrust-version = "1.80"\n' },
            'posthog-rs',
          )
        ).ok,
      ).toBe(true);
    });
  });

  describe('iOS 15, macOS 11, no CocoaPods', () => {
    const pbxproj = (ios: string, mac?: string) =>
      [
        'buildSettings = {',
        `IPHONEOS_DEPLOYMENT_TARGET = ${ios};`,
        'SWIFT_VERSION = 5.0;',
        '};',
        'buildSettings = {',
        'IPHONEOS_DEPLOYMENT_TARGET = 17.0;',
        ...(mac ? [`MACOSX_DEPLOYMENT_TARGET = ${mac};`] : []),
        '};',
      ].join('\n');

    it('fails a CocoaPods install of PostHog before anything else', async () => {
      expect(
        await floor(
          { Podfile: "platform :ios, '16.0'\npod 'PostHog'\n" },
          'posthog-ios',
        ),
      ).toMatchObject({
        ok: false,
        reason: expect.stringContaining('CocoaPods'),
      });
    });

    it('takes the lowest deployment target across build configurations', async () => {
      expect(
        await floor(
          { 'App.xcodeproj/project.pbxproj': pbxproj('13.0') },
          'posthog-ios',
        ),
      ).toEqual({
        ok: false,
        reason:
          'App.xcodeproj/project.pbxproj IPHONEOS_DEPLOYMENT_TARGET 13.0 is below 15.0',
      });
      expect(
        (
          await floor(
            { 'App.xcodeproj/project.pbxproj': pbxproj('15.0') },
            'posthog-ios',
          )
        ).ok,
      ).toBe(true);
      expect(
        await floor(
          { 'App.xcodeproj/project.pbxproj': pbxproj('15.0', '10.15') },
          'posthog-ios',
        ),
      ).toMatchObject({
        ok: false,
        reason: expect.stringContaining(
          'MACOSX_DEPLOYMENT_TARGET 10.15 is below 11.0',
        ),
      });
    });

    it('checks tvOS 15 and watchOS 10 targets too', async () => {
      const tv =
        'buildSettings = {\nIPHONEOS_DEPLOYMENT_TARGET = 16.0;\nTVOS_DEPLOYMENT_TARGET = 13.0;\n};';
      expect(
        await floor({ 'App.xcodeproj/project.pbxproj': tv }, 'posthog-ios'),
      ).toMatchObject({
        ok: false,
        reason: expect.stringContaining(
          'TVOS_DEPLOYMENT_TARGET 13.0 is below 15.0',
        ),
      });
      const watch =
        'buildSettings = {\nIPHONEOS_DEPLOYMENT_TARGET = 16.0;\nWATCHOS_DEPLOYMENT_TARGET = 7.0;\n};';
      expect(
        await floor({ 'App.xcodeproj/project.pbxproj': watch }, 'posthog-ios'),
      ).toMatchObject({
        ok: false,
        reason: expect.stringContaining(
          'WATCHOS_DEPLOYMENT_TARGET 7.0 is below 10.0',
        ),
      });
    });

    it('takes the lowest XcodeGen target across the project default and per-target overrides', async () => {
      const yml =
        'name: App\noptions:\n  deploymentTarget:\n    iOS: "16.0"\ntargets:\n  Legacy:\n    deploymentTarget:\n      iOS: 13.0\n';
      expect(await floor({ 'project.yml': yml }, 'posthog-ios')).toEqual({
        ok: false,
        reason: 'project.yml deploymentTarget iOS 13.0 is below 15.0',
      });
    });

    it('reads Podfile platforms and XcodeGen deployment targets', async () => {
      expect(
        await floor({ Podfile: "platform :ios, '14.0'\n" }, 'posthog-ios'),
      ).toEqual({
        ok: false,
        reason: 'Podfile platform :ios 14.0 is below 15.0',
      });
      expect(
        await floor(
          {
            'project.yml':
              'name: App\noptions:\n  deploymentTarget:\n    iOS: "13.0"\n',
          },
          'posthog-ios',
        ),
      ).toEqual({
        ok: false,
        reason: 'project.yml deploymentTarget iOS 13.0 is below 15.0',
      });
      expect(
        (
          await floor(
            {
              'project.yml':
                'name: App\noptions:\n  deploymentTarget:\n    iOS: 15\n    macOS: "12.0"\n',
            },
            'posthog-ios',
          )
        ).ok,
      ).toBe(true);
    });
  });

  describe('Flutter 3.41, SPM targets, no add-to-app', () => {
    it('fails an add-to-app module layout', async () => {
      expect(
        await floor({ '.ios/Flutter/podhelper.rb': '' }, 'posthog-flutter'),
      ).toMatchObject({
        ok: false,
        reason: expect.stringContaining('add-to-app'),
      });
    });

    it('ignores the pubspec environment range: it declares a minimum, not the SDK in use', async () => {
      expect(
        (
          await floor(
            {
              'pubspec.yaml':
                'name: app\nenvironment:\n  sdk: ^3.5.0\n  flutter: ">=3.22.0"\n',
            },
            'posthog-flutter',
          )
        ).ok,
      ).toBe(true);
    });

    it.each([
      ['.fvmrc', '{"flutter": "3.38.0"}', '.fvmrc'],
      [
        '.fvm/fvm_config.json',
        '{"flutterSdkVersion": "3.40.2"}',
        '.fvm/fvm_config.json',
      ],
      [
        '.tool-versions',
        'nodejs 22.0.0\nflutter 3.32.0-stable\n',
        '.tool-versions',
      ],
    ])('reads the Flutter version from %s', async (file, content, source) => {
      const check = await floor({ [file]: content }, 'posthog-flutter');
      expect(check.ok).toBe(false);
      if (!check.ok)
        expect(check.reason).toMatch(
          new RegExp(
            `^Flutter \\(${source.replace(
              /[.()]/g,
              '\\$&',
            )}\\) 3\\.\\d+ is below 3\\.41$`,
          ),
        );
    });

    it('passes a recent pin and checks the platform Podfiles', async () => {
      expect(
        (await floor({ '.fvmrc': '{"flutter": "3.41.0"}' }, 'posthog-flutter'))
          .ok,
      ).toBe(true);
      expect(
        await floor(
          {
            '.fvmrc': '{"flutter": "3.44.0"}',
            'ios/Podfile': "platform :ios, '13.0'\n",
          },
          'posthog-flutter',
        ),
      ).toEqual({
        ok: false,
        reason: 'ios/Podfile platform :ios 13.0 is below 15.0',
      });
      expect(
        await floor(
          { 'macos/Podfile': "platform :osx, '10.15'\n" },
          'posthog-flutter',
        ),
      ).toEqual({
        ok: false,
        reason: 'macos/Podfile platform :osx 10.15 is below 11.0',
      });
    });
  });

  it('Android: the framework version check owns minSdk, so the floor passes', async () => {
    expect(
      (
        await floor(
          {
            'app/build.gradle.kts':
              'android {\n    defaultConfig {\n        minSdk = 21\n    }\n}\n',
          },
          'posthog-android',
        )
      ).ok,
    ).toBe(true);
  });
});
