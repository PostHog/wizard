import { Integration } from '@shared/constants';
import { resolveSdkCaptureMode } from '@shared/sdk-capture-mode';
import { SDK_MAJORS } from '@shared/sdk-majors';
import { withSdkInstallInstructions } from '@services/detection/sdk-install-recommendation';
import type { PackageManagerInfo } from '@utils/package-manager';

const pnpm = {
  name: 'pnpm',
  label: 'pnpm',
  installCommand: 'pnpm add',
  runCommand: 'pnpm',
};
const base: PackageManagerInfo = {
  detected: [pnpm],
  primary: pnpm,
  recommendation: 'Use pnpm (pnpm add).',
};
const detector = () => Promise.resolve(base);
const nodeSession = (
  sdkCaptureModes: ReturnType<typeof resolveSdkCaptureMode>[],
  frameworkContext: Record<string, unknown> = {},
) => ({
  integration: Integration.javascriptNode,
  sdkCaptureModes,
  frameworkContext,
});

describe('withSdkInstallInstructions', () => {
  it('returns the detector result untouched when the run resolved no SDK', async () => {
    const wrapped = withSdkInstallInstructions(detector, () => ({
      integration: Integration.javascript_web,
      sdkCaptureModes: [],
      frameworkContext: {},
    }));
    expect(await wrapped('/tmp/app')).toEqual(base);
  });

  it('appends the pinned command for a fresh install and lists it in sdkInstalls', async () => {
    const wrapped = withSdkInstallInstructions(detector, () =>
      nodeSession([resolveSdkCaptureMode({ sdk: 'posthog-node' })]),
    );
    const info = await wrapped('/tmp/app');
    expect(info.detected).toEqual([pnpm]);
    expect(info.recommendation).toContain(
      'run exactly `pnpm add posthog-node@^5` (the 5.x line this run uses)',
    );
    expect(info.sdkInstalls).toEqual([
      expect.objectContaining({
        sdk: 'posthog-node',
        mode: 'legacy',
        major: 5,
        command: 'pnpm add posthog-node@^5',
      }),
    ]);
  });

  it('reads the session on every call, so a mode settled after the run was built reaches the command', async () => {
    const session = nodeSession([
      resolveSdkCaptureMode({ sdk: 'posthog-node' }),
    ]);
    const wrapped = withSdkInstallInstructions(detector, () => session);
    expect((await wrapped('/tmp/app')).sdkInstalls?.[0].command).toBe(
      'pnpm add posthog-node@^5',
    );
    session.sdkCaptureModes = [
      resolveSdkCaptureMode(
        { sdk: 'posthog-node', flagPayload: { 'posthog-node': 'v1' } },
        SDK_MAJORS.map((row) =>
          row.sdk === 'posthog-node' ? { ...row, v1Released: true } : row,
        ),
      ),
    ];
    expect((await wrapped('/tmp/app')).sdkInstalls?.[0].command).toBe(
      'pnpm add posthog-node@^6',
    );
  });

  it('defaults a Node project without a lockfile to npm', async () => {
    const wrapped = withSdkInstallInstructions(
      () =>
        Promise.resolve({
          detected: [],
          primary: null,
          recommendation:
            'No lockfile found. Default to npm (npm add, npm run).',
        }),
      () => nodeSession([resolveSdkCaptureMode({ sdk: 'posthog-node' })]),
    );
    expect((await wrapped('/tmp/app')).sdkInstalls?.[0].command).toBe(
      'npm add posthog-node@^5',
    );
  });

  it('tells the agent to leave an installed copy alone and renders no command', async () => {
    const wrapped = withSdkInstallInstructions(detector, () =>
      nodeSession([
        resolveSdkCaptureMode({
          sdk: 'posthog-node',
          installed: [{ major: 6, version: '6.0.1', source: 'pnpm-lock.yaml' }],
        }),
      ]),
    );
    const info = await wrapped('/tmp/app');
    expect(info.recommendation).toContain(
      'posthog-node: 6.0.1 is already installed (pnpm-lock.yaml); do not install, upgrade or downgrade it.',
    );
    expect(info.sdkInstalls).toEqual([]);
  });

  it('names a conflict and renders no command', async () => {
    const wrapped = withSdkInstallInstructions(detector, () =>
      nodeSession([
        resolveSdkCaptureMode({
          sdk: 'posthog-node',
          installed: [
            { major: 5, version: '5.60.0', source: 'package.json' },
            { major: 6, version: '6.0.1', source: 'pnpm-lock.yaml' },
          ],
        }),
      ]),
    );
    const info = await wrapped('/tmp/app');
    expect(info.recommendation).toContain('copies on different major lines');
    expect(info.sdkInstalls).toEqual([]);
  });

  it('passes the Rust blocking variant through from the framework context', async () => {
    const cargo = {
      name: 'cargo',
      label: 'Cargo',
      installCommand: 'cargo add',
    };
    const wrapped = withSdkInstallInstructions(
      () =>
        Promise.resolve({
          detected: [cargo],
          primary: cargo,
          recommendation: 'Use Cargo (cargo add).',
        }),
      () => ({
        integration: Integration.rust,
        sdkCaptureModes: [resolveSdkCaptureMode({ sdk: 'posthog-rs' })],
        frameworkContext: { asyncRuntime: false },
      }),
    );
    expect((await wrapped('/tmp/app')).sdkInstalls?.[0].command).toBe(
      'cargo add posthog-rs@0 --no-default-features',
    );
  });

  it('renders the manifest declaration where there is no add command', async () => {
    const gradle = {
      name: 'gradle',
      label: 'Gradle',
      installCommand: 'implementation',
    };
    const wrapped = withSdkInstallInstructions(
      () =>
        Promise.resolve({
          detected: [gradle],
          primary: gradle,
          recommendation: 'Add dependencies to build.gradle(.kts).',
        }),
      () => ({
        integration: Integration.android,
        sdkCaptureModes: [resolveSdkCaptureMode({ sdk: 'posthog-android' })],
        frameworkContext: {},
      }),
    );
    expect((await wrapped('/tmp/app')).recommendation).toContain(
      'declare exactly: implementation("com.posthog:posthog-android:3.75.0")',
    );
  });
});
