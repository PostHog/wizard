/**
 * The exact install for one SDK in one capture mode, in the project's package
 * manager. Every command pins the major from the `SDK_MAJORS` table, so the
 * agent never runs a bare install that resolves to whatever the registry
 * published last.
 */
import type { SdkCaptureMode, SdkId, SdkMajorRow } from './sdk-majors';
import { majorForMode } from './sdk-majors';

export interface SdkInstallInstruction {
  readonly sdk: SdkId;
  readonly mode: SdkCaptureMode;
  readonly major: number;
  /** The shell command, where the ecosystem has one. */
  readonly command?: string;
  /** The manifest declaration, where the ecosystem has no add command (Gradle, Xcode). */
  readonly manifest?: string;
  readonly notes: readonly string[];
}

export interface SdkInstallOptions {
  /** Rust only: the project has no async runtime, so the blocking client's features apply. */
  readonly rustBlocking?: boolean;
}

/**
 * `packageManager` is the detected manager's `installCommand` (`pnpm add`,
 * `poetry add`, `pip install`); ecosystems with one manager ignore it.
 */
export function renderSdkInstall(
  row: SdkMajorRow,
  mode: SdkCaptureMode,
  packageManager: string,
  options: SdkInstallOptions = {},
): SdkInstallInstruction {
  const major = majorForMode(row, mode);
  const pin = row.pins[mode];
  const pkg = row.packages[mode][0];
  const base = { sdk: row.sdk, mode, major };
  switch (row.ecosystem) {
    case 'npm':
      return {
        ...base,
        command: `${packageManager} ${pkg}@${pin}`,
        notes:
          mode === 'v1'
            ? [
                'Install @posthog/ai only in a release whose peer range admits posthog-node 6.',
              ]
            : [],
      };
    case 'pypi': {
      const spec = `${pkg}${pin}`;
      const command = packageManager.startsWith('poetry')
        ? `${packageManager} "${pkg}@${pin}"`
        : `${packageManager} "${spec}"`;
      return {
        ...base,
        command,
        notes: [
          `If the manager does not write the manifest (pip, conda), add \`${spec}\` to requirements.txt or the project manifest as well.`,
        ],
      };
    }
    case 'go':
      return {
        ...base,
        command: `go get ${pkg}${pin} && go mod tidy`,
        notes: [
          `Import exactly \`${pkg}\`; the module path is the major, and the other path is a different SDK generation.`,
        ],
      };
    case 'cargo': {
      const features = options.rustBlocking
        ? mode === 'v1'
          ? ' --no-default-features --features tls'
          : ' --no-default-features'
        : '';
      const notes = options.rustBlocking
        ? mode === 'v1'
          ? [
              'The blocking client needs the `tls` feature on 1.x; use `tls-no-provider` instead only when the app installs its own rustls crypto provider.',
            ]
          : ['The blocking client on 0.x keeps TLS without a feature flag.']
        : [];
      return {
        ...base,
        command: `cargo add ${pkg}@${pin}${features}`,
        notes,
      };
    }
    case 'pub':
      return { ...base, command: `flutter pub add ${pkg}:${pin}`, notes: [] };
    case 'spm':
      return {
        ...base,
        manifest: `Xcode: XCRemoteSwiftPackageReference for ${pkg} with requirement { kind = upToNextMajorVersion; minimumVersion = ${pin}; }. Package.swift: .package(url: "${pkg}", from: "${pin}"). XcodeGen project.yml: from: ${pin}.`,
        notes:
          mode === 'v1'
            ? [
                'posthog-ios 4 ships through Swift Package Manager only; there is no 4.x pod.',
              ]
            : [
                `A CocoaPods project uses pod 'PostHog', '~> ${major}.0' instead.`,
              ],
      };
    case 'maven':
      return {
        ...base,
        manifest: `implementation("${pkg}:${pin}")`,
        notes: [
          'Use this exact version; never a dynamic range such as 4.+. With a version catalog, put the version in gradle/libs.versions.toml.',
        ],
      };
  }
}
