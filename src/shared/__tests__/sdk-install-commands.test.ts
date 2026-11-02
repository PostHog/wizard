import { renderSdkInstall } from '@shared/sdk-install-commands';
import { SDK_MAJORS, getSdkMajorRow } from '@shared/sdk-majors';

describe('renderSdkInstall', () => {
  it.each([
    ['posthog-node', 'legacy', 'pnpm add', 'pnpm add posthog-node@^5'],
    ['posthog-node', 'v1', 'npm add', 'npm add posthog-node@^6'],
    ['posthog-python', 'legacy', 'uv add', 'uv add "posthog>=7,<8"'],
    ['posthog-python', 'v1', 'pip install', 'pip install "posthog>=8,<9"'],
    ['posthog-python', 'v1', 'poetry add', 'poetry add "posthog@>=8,<9"'],
    [
      'posthog-go',
      'legacy',
      'go get',
      'go get github.com/posthog/posthog-go@latest && go mod tidy',
    ],
    [
      'posthog-go',
      'v1',
      'go get',
      'go get github.com/posthog/posthog-go/v2@latest && go mod tidy',
    ],
    ['posthog-rs', 'legacy', 'cargo add', 'cargo add posthog-rs@0'],
    ['posthog-rs', 'v1', 'cargo add', 'cargo add posthog-rs@1'],
    [
      'posthog-flutter',
      'legacy',
      'flutter pub add',
      'flutter pub add posthog_flutter:^5.0.0',
    ],
    [
      'posthog-flutter',
      'v1',
      'flutter pub add',
      'flutter pub add posthog_flutter:^6.0.0',
    ],
  ] as const)(
    '%s %s with %s renders %s',
    (sdk, mode, packageManager, command) => {
      const instruction = renderSdkInstall(
        getSdkMajorRow(sdk),
        mode,
        packageManager,
      );
      expect(instruction.command).toBe(command);
      expect(instruction.manifest).toBeUndefined();
      expect(instruction).toMatchObject({ sdk, mode });
    },
  );

  it('gives the blocking Rust client its features, with TLS only on 1.x', () => {
    const rust = getSdkMajorRow('posthog-rs');
    expect(
      renderSdkInstall(rust, 'legacy', 'cargo add', { rustBlocking: true })
        .command,
    ).toBe('cargo add posthog-rs@0 --no-default-features');
    const v1 = renderSdkInstall(rust, 'v1', 'cargo add', {
      rustBlocking: true,
    });
    expect(v1.command).toBe(
      'cargo add posthog-rs@1 --no-default-features --features tls',
    );
    expect(v1.notes[0]).toContain('tls-no-provider');
  });

  it('renders a manifest declaration for Swift Package Manager and Gradle', () => {
    const ios = renderSdkInstall(getSdkMajorRow('posthog-ios'), 'v1', '');
    expect(ios.command).toBeUndefined();
    expect(ios.manifest).toContain('minimumVersion = 4.0.0');
    expect(ios.manifest).toContain('from: "4.0.0"');
    expect(ios.notes[0]).toContain('no 4.x pod');
    expect(
      renderSdkInstall(getSdkMajorRow('posthog-ios'), 'legacy', '').notes[0],
    ).toContain("pod 'PostHog', '~> 3.0'");

    const android = renderSdkInstall(
      getSdkMajorRow('posthog-android'),
      'legacy',
      'implementation',
    );
    expect(android.manifest).toBe(
      'implementation("com.posthog:posthog-android:3.75.0")',
    );
    expect(android.notes[0]).toContain('never a dynamic range');
  });

  it('tells pip users to write the specifier into the manifest too', () => {
    const notes = renderSdkInstall(
      getSdkMajorRow('posthog-python'),
      'legacy',
      'pip install',
    ).notes;
    expect(notes[0]).toContain('posthog>=7,<8');
    expect(notes[0]).toContain('requirements.txt');
  });

  it('never renders a bare package name for any row or mode', () => {
    for (const row of SDK_MAJORS) {
      for (const mode of ['legacy', 'v1'] as const) {
        const { command, manifest } = renderSdkInstall(row, mode, 'x add');
        const text = command ?? manifest ?? '';
        expect(text).toContain(row.pins[mode]);
      }
    }
  });
});
