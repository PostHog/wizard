import { Integration, WIZARD_SDK_CAPTURE_V1_FLAG_KEY } from '@shared/constants';
import {
  applySdkCaptureModeFlags,
  detectSdkCaptureModes,
  sdkCaptureModeFacts,
} from '@services/detection/sdk-capture-modes';
import { withProject } from '@services/detection/sdk-install/__tests__/helpers.no-jest';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

const UV_LOCK = '[[package]]\nname = "posthog"\nversion = "7.82.1"\n';

describe('detectSdkCaptureModes', () => {
  it('resolves the primary SDK from an installed copy', async () => {
    const modes = await withProject({ 'uv.lock': UV_LOCK }, (dir) =>
      detectSdkCaptureModes(dir, Integration.fastapi),
    );
    expect(modes).toEqual([
      expect.objectContaining({
        sdk: 'posthog-python',
        mode: 'legacy',
        major: 7,
        reason: 'installed',
        detail: 'uv.lock',
      }),
    ]);
  });

  it('resolves a fresh install to the row default and keeps a server-rendered framework on legacy posthog-node', async () => {
    const fresh = await withProject(
      { 'package.json': '{"dependencies":{"next":"15.0.0"}}' },
      (dir) => detectSdkCaptureModes(dir, Integration.nextjs),
    );
    expect(fresh).toEqual([
      expect.objectContaining({
        sdk: 'posthog-node',
        mode: 'legacy',
        major: 5,
        reason: 'secondary-policy',
        installed: [],
      }),
    ]);
  });

  it('resolves nothing for an integration outside the allowlist', async () => {
    expect(
      await withProject({}, (dir) =>
        detectSdkCaptureModes(dir, Integration.javascript_web),
      ),
    ).toEqual([]);
  });

  it('applies a flag payload when given one', async () => {
    const modes = await withProject({}, (dir) =>
      detectSdkCaptureModes(dir, Integration.rust, {
        [WIZARD_SDK_CAPTURE_V1_FLAG_KEY]: { 'posthog-rs': 'v1' },
      }),
    );
    expect(modes[0]).toMatchObject({ mode: 'v1', major: 1, reason: 'flag' });
  });
});

describe('applySdkCaptureModeFlags', () => {
  it('re-resolves from the copies detection read, without touching the disk', async () => {
    const detected = await withProject({}, (dir) =>
      detectSdkCaptureModes(dir, Integration.go),
    );
    expect(detected[0]).toMatchObject({
      mode: 'legacy',
      reason: 'not-released',
    });

    const session = { integration: Integration.go, sdkCaptureModes: detected };
    expect(
      applySdkCaptureModeFlags(session, {
        [WIZARD_SDK_CAPTURE_V1_FLAG_KEY]: { 'posthog-go': 'v1' },
      })[0],
    ).toMatchObject({ mode: 'v1', major: 2, reason: 'flag' });
    expect(applySdkCaptureModeFlags(session, {})[0]).toEqual(detected[0]);
  });

  it('leaves an installed copy alone whatever the flag says', async () => {
    const detected = await withProject({ 'uv.lock': UV_LOCK }, (dir) =>
      detectSdkCaptureModes(dir, Integration.python),
    );
    const session = {
      integration: Integration.python,
      sdkCaptureModes: detected,
    };
    expect(
      applySdkCaptureModeFlags(session, {
        [WIZARD_SDK_CAPTURE_V1_FLAG_KEY]: { 'posthog-python': 'v1' },
      })[0],
    ).toMatchObject({ mode: 'legacy', major: 7, reason: 'installed' });
  });
});

describe('sdkCaptureModeFacts', () => {
  it('tells the agent the major line for a fresh install', async () => {
    const sdkCaptureModes = await withProject({}, (dir) =>
      detectSdkCaptureModes(dir, Integration.django),
    );
    expect(sdkCaptureModes).toHaveLength(1);
    expect(sdkCaptureModeFacts({ sdkCaptureModes })).toEqual([
      'PostHog SDK posthog-python: this run uses the 7.x line (legacy capture API). Install 7.x only, never 8.x.',
    ]);
  });

  it('tells the agent to keep an installed copy', async () => {
    const sdkCaptureModes = await withProject(
      {
        'go.mod':
          'module app\n\ngo 1.22\n\nrequire github.com/posthog/posthog-go/v2 v2.0.0\n',
      },
      (dir) => detectSdkCaptureModes(dir, Integration.go),
    );
    expect(sdkCaptureModeFacts({ sdkCaptureModes })).toEqual([
      'PostHog SDK posthog-go: github.com/posthog/posthog-go/v2 v2.0.0 is already installed (go.mod), the 2.x line (capture v1 API). Keep it; do not upgrade or downgrade it in this run.',
    ]);
  });

  it('names both copies of a conflict', async () => {
    const sdkCaptureModes = await withProject(
      {
        'go.mod':
          'module app\n\nrequire (\n\tgithub.com/posthog/posthog-go v1.39.0\n\tgithub.com/posthog/posthog-go/v2 v2.0.0\n)\n',
      },
      (dir) => detectSdkCaptureModes(dir, Integration.go),
    );
    expect(sdkCaptureModes[0].mode).toBe('conflict');
    expect(sdkCaptureModeFacts({ sdkCaptureModes })[0]).toContain(
      'copies on different major lines (github.com/posthog/posthog-go v1.39.0 from go.mod, github.com/posthog/posthog-go/v2 v2.0.0 from go.mod)',
    );
  });

  it('is empty when nothing was resolved', () => {
    expect(sdkCaptureModeFacts({ sdkCaptureModes: [] })).toEqual([]);
  });
});
