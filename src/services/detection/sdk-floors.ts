/**
 * The project-side floors a capture v1 major needs, read from manifests only
 * (no toolchain probes: the agent's shell fence blocks them and a wrong guess
 * would send a working project to legacy). Unknown passes; a value below the
 * floor fails with a reason the prompt and telemetry carry.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { SdkFloorCheck } from '@shared/sdk-capture-mode';
import type { SdkId } from '@shared/sdk-majors';
import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import { compareVersions, lowerBoundVersion } from './sdk-install/version-spec';

type Version = { major: number; minor: number };
const OK: SdkFloorCheck = { ok: true };
const fail = (reason: string): SdkFloorCheck => ({ ok: false, reason });
const v = (major: number, minor: number): Version => ({ major, minor });
const show = (version: Version) => `${version.major}.${version.minor}`;

/** Fails when a found version sits below `floor`; a missing or unparsable value passes. */
function atLeast(
  found: Version | undefined,
  floor: Version,
  what: string,
): SdkFloorCheck {
  if (!found || compareVersions(found, floor) >= 0) return OK;
  return fail(`${what} ${show(found)} is below ${show(floor)}`);
}

function read(installDir: string, ...segments: string[]): string | null {
  return readProjectFile(path.join(installDir, ...segments));
}

// posthog-python 8 needs Python 3.10.
function pythonFloor(installDir: string): SdkFloorCheck {
  const floor = v(3, 10);
  const pyproject = read(installDir, 'pyproject.toml');
  const requires = pyproject
    ? /^\s*requires-python\s*=\s*"([^"]+)"/m.exec(pyproject)?.[1]
    : undefined;
  if (requires) {
    const check = atLeast(
      lowerBoundVersion(requires),
      floor,
      'requires-python',
    );
    if (!check.ok) return check;
  }
  const pinned = read(installDir, '.python-version')?.trim().split('\n')[0];
  if (pinned) {
    return atLeast(lowerBoundVersion(pinned), floor, '.python-version');
  }
  return OK;
}

// posthog-go v2 needs Go 1.21.
function goFloor(installDir: string): SdkFloorCheck {
  const goMod = read(installDir, 'go.mod');
  const directive = goMod ? /^go\s+(\d+\.\d+)/m.exec(goMod)?.[1] : undefined;
  return atLeast(
    directive ? lowerBoundVersion(directive) : undefined,
    v(1, 21),
    'go.mod go directive',
  );
}

// posthog-rs 1 needs Rust 1.78.
function rustFloor(installDir: string): SdkFloorCheck {
  const floor = v(1, 78);
  const cargo = read(installDir, 'Cargo.toml');
  const rustVersion = cargo
    ? /^\s*rust-version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]
    : undefined;
  if (rustVersion) {
    const check = atLeast(
      lowerBoundVersion(rustVersion),
      floor,
      'rust-version',
    );
    if (!check.ok) return check;
  }
  const toolchain = read(installDir, 'rust-toolchain.toml');
  const channel = toolchain
    ? /^\s*channel\s*=\s*"([^"]+)"/m.exec(toolchain)?.[1]
    : undefined;
  // Named channels (stable, nightly) track a current compiler and pass.
  if (channel && /^\d/.test(channel)) {
    return atLeast(lowerBoundVersion(channel), floor, 'rust-toolchain channel');
  }
  return OK;
}

/** The lowest `KEY = value` across a pbxproj's build configurations. */
function lowestBuildSetting(pbxproj: string, key: string): Version | undefined {
  let lowest: Version | undefined;
  const pattern = new RegExp(`${key}\\s*=\\s*"?(\\d+)(?:\\.(\\d+))?`, 'g');
  for (const match of pbxproj.matchAll(pattern)) {
    const found = v(Number(match[1]), Number(match[2] ?? 0));
    if (!lowest || compareVersions(found, lowest) < 0) lowest = found;
  }
  return lowest;
}

/** The lowest `<platform>: <version>` across the project default and every per-target override. */
function lowestYamlTarget(yml: string, platform: string): Version | undefined {
  let lowest: Version | undefined;
  const pattern = new RegExp(
    `^\\s*${platform}:\\s*"?(\\d+(?:\\.\\d+)?)"?`,
    'gm',
  );
  for (const match of yml.matchAll(pattern)) {
    const raw = match[1].includes('.') ? match[1] : `${match[1]}.0`;
    const found = lowerBoundVersion(raw);
    if (found && (!lowest || compareVersions(found, lowest) < 0))
      lowest = found;
  }
  return lowest;
}

function podfilePlatform(
  podfile: string,
  platform: 'ios' | 'osx',
): Version | undefined {
  const match = new RegExp(
    `^\\s*platform\\s+:${platform}\\s*,\\s*['"]([^'"]+)['"]`,
    'm',
  ).exec(podfile);
  return match ? lowerBoundVersion(match[1]) : undefined;
}

// posthog-ios 4 is SPM only and needs iOS 15, macOS 11, tvOS 15 and watchOS 10 (Xcode 26 cannot be read from the project).
async function iosFloor(installDir: string): Promise<SdkFloorCheck> {
  const podfile = read(installDir, 'Podfile');
  if (podfile && /^\s*pod\s+['"]PostHog['"]/m.test(podfile)) {
    return fail(
      'PostHog is installed through CocoaPods; posthog-ios 4 ships through Swift Package Manager only',
    );
  }
  if (podfile) {
    const ios = atLeast(
      podfilePlatform(podfile, 'ios'),
      v(15, 0),
      'Podfile platform :ios',
    );
    if (!ios.ok) return ios;
    const osx = atLeast(
      podfilePlatform(podfile, 'osx'),
      v(11, 0),
      'Podfile platform :osx',
    );
    if (!osx.ok) return osx;
  }
  const projects = await boundedGlob('*.xcodeproj/project.pbxproj', {
    cwd: installDir,
    limit: 10,
  });
  for (const file of projects.sort()) {
    const pbxproj = read(installDir, file);
    if (!pbxproj) continue;
    const ios = atLeast(
      lowestBuildSetting(pbxproj, 'IPHONEOS_DEPLOYMENT_TARGET'),
      v(15, 0),
      `${file} IPHONEOS_DEPLOYMENT_TARGET`,
    );
    if (!ios.ok) return ios;
    const mac = atLeast(
      lowestBuildSetting(pbxproj, 'MACOSX_DEPLOYMENT_TARGET'),
      v(11, 0),
      `${file} MACOSX_DEPLOYMENT_TARGET`,
    );
    if (!mac.ok) return mac;
    const tv = atLeast(
      lowestBuildSetting(pbxproj, 'TVOS_DEPLOYMENT_TARGET'),
      v(15, 0),
      `${file} TVOS_DEPLOYMENT_TARGET`,
    );
    if (!tv.ok) return tv;
    const watch = atLeast(
      lowestBuildSetting(pbxproj, 'WATCHOS_DEPLOYMENT_TARGET'),
      v(10, 0),
      `${file} WATCHOS_DEPLOYMENT_TARGET`,
    );
    if (!watch.ok) return watch;
  }
  const xcodegen = read(installDir, 'project.yml');
  if (xcodegen) {
    const ios = atLeast(
      lowestYamlTarget(xcodegen, 'iOS'),
      v(15, 0),
      'project.yml deploymentTarget iOS',
    );
    if (!ios.ok) return ios;
    return atLeast(
      lowestYamlTarget(xcodegen, 'macOS'),
      v(11, 0),
      'project.yml deploymentTarget macOS',
    );
  }
  return OK;
}

/**
 * The Flutter SDK version a project pins, from fvm or asdf. The pubspec
 * `environment.flutter` range is a declared minimum, not the SDK in use, so it
 * is not read: a current project with an old constraint must not go legacy.
 */
function flutterVersion(installDir: string): {
  found: Version | undefined;
  source: string;
} {
  const fvmrc = read(installDir, '.fvmrc');
  const fvm = fvmrc ? /"flutter"\s*:\s*"([^"]+)"/.exec(fvmrc)?.[1] : undefined;
  if (fvm) return { found: lowerBoundVersion(fvm), source: '.fvmrc' };
  const fvmConfig = read(installDir, '.fvm', 'fvm_config.json');
  const legacyFvm = fvmConfig
    ? /"flutterSdkVersion"\s*:\s*"([^"]+)"/.exec(fvmConfig)?.[1]
    : undefined;
  if (legacyFvm)
    return {
      found: lowerBoundVersion(legacyFvm),
      source: '.fvm/fvm_config.json',
    };
  const toolVersions = read(installDir, '.tool-versions');
  const asdf = toolVersions
    ? /^flutter\s+(\S+)/m.exec(toolVersions)?.[1]
    : undefined;
  if (asdf) return { found: lowerBoundVersion(asdf), source: '.tool-versions' };
  return { found: undefined, source: '' };
}

// posthog_flutter 6 needs Flutter 3.41, Swift Package Manager, iOS 15 and macOS 11, and is not for add-to-app modules.
function flutterFloor(installDir: string): SdkFloorCheck {
  for (const dir of ['.ios/Flutter', '.android/Flutter']) {
    if (fs.existsSync(path.join(installDir, dir))) {
      return fail(
        `${dir} marks an add-to-app module, which posthog_flutter 6 does not support`,
      );
    }
  }
  const { found, source } = flutterVersion(installDir);
  const sdk = atLeast(found, v(3, 41), `Flutter (${source})`);
  if (!sdk.ok) return sdk;
  const iosPodfile = read(installDir, 'ios', 'Podfile');
  if (iosPodfile) {
    const ios = atLeast(
      podfilePlatform(iosPodfile, 'ios'),
      v(15, 0),
      'ios/Podfile platform :ios',
    );
    if (!ios.ok) return ios;
  }
  const macPodfile = read(installDir, 'macos', 'Podfile');
  if (macPodfile) {
    return atLeast(
      podfilePlatform(macPodfile, 'osx'),
      v(11, 0),
      'macos/Podfile platform :osx',
    );
  }
  return OK;
}

// posthog-android 3 and 4 both need minSdk 23; the Android framework config's
// own version check stops a lower project before any mode is resolved.
const androidFloor = (): SdkFloorCheck => OK;

const FLOORS: Record<
  SdkId,
  (installDir: string) => SdkFloorCheck | Promise<SdkFloorCheck>
> = {
  'posthog-python': pythonFloor,
  'posthog-go': goFloor,
  'posthog-rs': rustFloor,
  'posthog-ios': iosFloor,
  'posthog-flutter': flutterFloor,
  'posthog-android': androidFloor,
  // posthog-node 6 keeps 5.x's Node range; nothing to check.
  'posthog-node': () => OK,
};

export function checkSdkFloor(
  installDir: string,
  sdk: SdkId,
): Promise<SdkFloorCheck> {
  return Promise.resolve(FLOORS[sdk](installDir));
}
