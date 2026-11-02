import { Integration } from '@shared/constants';
import { resolveSdkCaptureMode } from '@shared/sdk-capture-mode';
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

describe('withSdkInstallInstructions', () => {
  it('returns the detector untouched when the run resolved no SDK', () => {
    const wrapped = withSdkInstallInstructions(detector, {
      integration: Integration.javascript_web,
      sdkCaptureModes: [],
      frameworkContext: {},
    });
    expect(wrapped).toBe(detector);
  });

  it('appends the pinned command for a fresh install and lists it in sdkInstalls', async () => {
    const wrapped = withSdkInstallInstructions(detector, {
      integration: Integration.javascriptNode,
      sdkCaptureModes: [resolveSdkCaptureMode({ sdk: 'posthog-node' })],
      frameworkContext: {},
    });
    const info = await wrapped('/tmp/app');
    expect(info.detected).toEqual([pnpm]);
    expect(info.recommendation).toBe(
      'Use pnpm (pnpm add). PostHog SDK posthog-node: run exactly `pnpm add posthog-node@^5` (the 5.x line this run uses). Never install it by bare name or change the major.',
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

  it('tells the agent to leave an installed copy alone and renders no command', async () => {
    const wrapped = withSdkInstallInstructions(detector, {
      integration: Integration.javascriptNode,
      sdkCaptureModes: [
        resolveSdkCaptureMode({
          sdk: 'posthog-node',
          installed: [{ major: 6, version: '6.0.1', source: 'pnpm-lock.yaml' }],
        }),
      ],
      frameworkContext: {},
    });
    const info = await wrapped('/tmp/app');
    expect(info.recommendation).toContain(
      'posthog-node: 6.0.1 is already installed (pnpm-lock.yaml); do not install, upgrade or downgrade it.',
    );
    expect(info.sdkInstalls).toEqual([]);
  });

  it('names a conflict and renders no command', async () => {
    const wrapped = withSdkInstallInstructions(detector, {
      integration: Integration.javascriptNode,
      sdkCaptureModes: [
        resolveSdkCaptureMode({
          sdk: 'posthog-node',
          installed: [
            { major: 5, version: '5.60.0', source: 'package.json' },
            { major: 6, version: '6.0.1', source: 'pnpm-lock.yaml' },
          ],
        }),
      ],
      frameworkContext: {},
    });
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
      {
        integration: Integration.rust,
        sdkCaptureModes: [resolveSdkCaptureMode({ sdk: 'posthog-rs' })],
        frameworkContext: { asyncRuntime: false },
      },
    );
    const info = await wrapped('/tmp/app');
    expect(info.sdkInstalls?.[0].command).toBe(
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
      {
        integration: Integration.android,
        sdkCaptureModes: [resolveSdkCaptureMode({ sdk: 'posthog-android' })],
        frameworkContext: {},
      },
    );
    const info = await wrapped('/tmp/app');
    expect(info.recommendation).toContain(
      'declare exactly: implementation("com.posthog:posthog-android:3.75.0")',
    );
  });
});
