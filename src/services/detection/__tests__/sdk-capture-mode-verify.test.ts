import { Integration } from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import { resolveSdkCaptureMode } from '@shared/sdk-capture-mode';
import { detectSdkCaptureModes } from '@services/detection/sdk-capture-modes';
import {
  sdkConflictFailure,
  verifySdkCaptureModes,
} from '@services/detection/sdk-capture-mode-verify';
import { withProject } from '@services/detection/sdk-install/__tests__/helpers.no-jest';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

const legacyNode = resolveSdkCaptureMode({ sdk: 'posthog-node' });
const lockWith = (version: string) =>
  `lockfileVersion: 9.0\npackages:\n  posthog-node@${version}:\n    resolution: {integrity: sha512-x}\n`;

describe('verifySdkCaptureModes', () => {
  it('passes when nothing is installed yet or the copy is on the run line', async () => {
    await expect(
      withProject({}, (installDir) =>
        verifySdkCaptureModes({ installDir, sdkCaptureModes: [legacyNode] }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      withProject({ 'pnpm-lock.yaml': lockWith('5.61.2') }, (installDir) =>
        verifySdkCaptureModes({ installDir, sdkCaptureModes: [legacyNode] }),
      ),
    ).resolves.toBeUndefined();
  });

  it('fails the run when the install landed on the other major line', async () => {
    const failure = await withProject(
      { 'pnpm-lock.yaml': lockWith('6.0.1') },
      (installDir) =>
        verifySdkCaptureModes({ installDir, sdkCaptureModes: [legacyNode] }),
    );
    expect(failure).toMatchObject({
      code: ErrorCodes.AgentSdkMajorMismatch,
      detail: {
        sdk: 'posthog-node',
        capture_mode: 'legacy',
        expected_major: 5,
        installed_version: '6.0.1',
        installed_source: 'pnpm-lock.yaml',
      },
    });
    expect(failure?.message).toContain(
      'set up posthog-node for the 5.x line (legacy capture API), but 6.0.1 (pnpm-lock.yaml) is installed now',
    );
    expect(failure?.message).toContain(
      'Install it again with `npm add posthog-node@^5`',
    );
  });

  it('catches a copy that moved off an installed line during the run', async () => {
    const detected = await withProject(
      { 'pnpm-lock.yaml': lockWith('6.0.1') },
      (installDir) =>
        detectSdkCaptureModes(installDir, Integration.javascriptNode),
    );
    expect(detected[0]).toMatchObject({ mode: 'v1', reason: 'installed' });
    const failure = await withProject(
      { 'pnpm-lock.yaml': lockWith('5.61.2') },
      (installDir) =>
        verifySdkCaptureModes({ installDir, sdkCaptureModes: detected }),
    );
    expect(failure?.code).toBe(ErrorCodes.AgentSdkMajorMismatch);
    expect(failure?.message).toContain('6.x line (capture v1 API)');
  });

  it('does nothing for a run with no resolved SDK or only a conflict', async () => {
    const conflict = resolveSdkCaptureMode({
      sdk: 'posthog-node',
      installed: [
        { major: 5, version: '5.60.0', source: 'package.json' },
        { major: 6, version: '6.0.1', source: 'pnpm-lock.yaml' },
      ],
    });
    await expect(
      withProject({ 'pnpm-lock.yaml': lockWith('6.0.1') }, (installDir) =>
        verifySdkCaptureModes({ installDir, sdkCaptureModes: [] }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      withProject({ 'pnpm-lock.yaml': lockWith('6.0.1') }, (installDir) =>
        verifySdkCaptureModes({ installDir, sdkCaptureModes: [conflict] }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('sdkConflictFailure', () => {
  it('stops the run before the agent when copies disagree on the line', () => {
    const conflict = resolveSdkCaptureMode({
      sdk: 'posthog-go',
      installed: [
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
      ],
    });
    const failure = sdkConflictFailure({ sdkCaptureModes: [conflict] });
    expect(failure).toMatchObject({ code: ErrorCodes.DetectSdkMajorConflict });
    expect(failure?.message).toBe(
      'The project has copies of posthog-go on different major lines: github.com/posthog/posthog-go v1.39.0 (go.mod) and github.com/posthog/posthog-go/v2 v2.0.0 (go.mod). Pick one line, remove the other, then run the wizard again.',
    );
  });

  it('is absent for a resolved or empty run', () => {
    expect(
      sdkConflictFailure({ sdkCaptureModes: [legacyNode] }),
    ).toBeUndefined();
    expect(sdkConflictFailure({ sdkCaptureModes: [] })).toBeUndefined();
  });
});

describe('verifySdkCaptureModes: message per ecosystem', () => {
  it('names the module path and the pinned command for Go, and the declaration for Gradle', async () => {
    const goRun = resolveSdkCaptureMode({ sdk: 'posthog-go' });
    const go = await withProject(
      {
        'go.mod':
          'module app\n\nrequire github.com/posthog/posthog-go/v2 v2.0.0\n',
      },
      (installDir) =>
        verifySdkCaptureModes({ installDir, sdkCaptureModes: [goRun] }),
    );
    expect(go?.message).toContain(
      'set up github.com/posthog/posthog-go for the 1.x line',
    );
    expect(go?.message).toContain(
      'go get github.com/posthog/posthog-go@latest',
    );
    const androidRun = resolveSdkCaptureMode({ sdk: 'posthog-android' });
    const android = await withProject(
      {
        'app/build.gradle':
          'dependencies { implementation("com.posthog:posthog-android:4.0.0") }\n',
      },
      (installDir) =>
        verifySdkCaptureModes({ installDir, sdkCaptureModes: [androidRun] }),
    );
    expect(android?.message).toContain(
      'Declare it as implementation("com.posthog:posthog-android:3.75.0")',
    );
  });
});
