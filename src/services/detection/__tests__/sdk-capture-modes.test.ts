import {
  Integration,
  WIZARD_SDK_CAPTURE_MODE_FLAG_KEY,
  WIZARD_SDK_CAPTURE_V1_FLAG_KEY,
} from '@shared/constants';
import {
  applySdkCaptureModeFlags,
  detectSdkCaptureModes,
  sdkCaptureModeFacts,
  settleSdkCaptureModes,
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

  it('never reads the flags itself; the run applies them when they load', async () => {
    const modes = await withProject({}, (dir) =>
      detectSdkCaptureModes(dir, Integration.rust),
    );
    expect(modes[0]).toMatchObject({ mode: 'legacy', reason: 'not-released' });
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
      'PostHog SDK posthog-python: this run uses the 7.x line (legacy capture API). Install 7.x only, never 8.x, with the exact command or declaration detect_package_manager returns; it overrides any install line in a skill or rule.',
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
    const [fact] = sdkCaptureModeFacts({ sdkCaptureModes });
    expect(fact).toContain(
      'PostHog SDK posthog-go: github.com/posthog/posthog-go/v2 v2.0.0 is already installed (go.mod), the 2.x line (capture v1 API). Keep it; do not upgrade or downgrade it in this run.',
    );
    expect(fact).toContain('AI capture method');
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

/** A flag snapshot with the gate on and the given payloads. */
const on = (payloads: Record<string, unknown>) => ({
  flags: { [WIZARD_SDK_CAPTURE_MODE_FLAG_KEY]: 'true' },
  payloads,
});

describe('settleSdkCaptureModes', () => {
  it('resolves nothing while the gate is off, whatever detection found', async () => {
    const detected = await withProject({ 'uv.lock': UV_LOCK }, (dir) =>
      detectSdkCaptureModes(dir, Integration.fastapi),
    );
    expect(detected).toHaveLength(1);
    await expect(
      settleSdkCaptureModes(
        {
          installDir: '/tmp/app',
          integration: Integration.fastapi,
          sdkCaptureModes: detected,
        },
        {
          flags: {},
          payloads: {
            [WIZARD_SDK_CAPTURE_V1_FLAG_KEY]: { 'posthog-python': 'v1' },
          },
        },
      ),
    ).resolves.toEqual([]);
  });

  it('reads the run directory when detection left no modes, and applies the flags', async () => {
    const settled = await withProject({ 'uv.lock': UV_LOCK }, (installDir) =>
      settleSdkCaptureModes(
        { installDir, integration: Integration.fastapi, sdkCaptureModes: [] },
        on({ [WIZARD_SDK_CAPTURE_V1_FLAG_KEY]: { 'posthog-python': 'v1' } }),
      ),
    );
    // An installed copy still wins over the flag.
    expect(settled).toEqual([
      expect.objectContaining({
        sdk: 'posthog-python',
        mode: 'legacy',
        reason: 'installed',
      }),
    ]);
  });

  it("keeps detection's copies when the run already has modes", async () => {
    const detected = await withProject({}, (dir) =>
      detectSdkCaptureModes(dir, Integration.go),
    );
    const settled = await withProject(
      {
        'go.mod':
          'module app\n\nrequire github.com/posthog/posthog-go/v2 v2.0.0\n',
      },
      (installDir) =>
        settleSdkCaptureModes(
          {
            installDir,
            integration: Integration.go,
            sdkCaptureModes: detected,
          },
          on({ [WIZARD_SDK_CAPTURE_V1_FLAG_KEY]: { 'posthog-go': 'v1' } }),
        ),
    );
    // The directory is not read again: the flag, not the go.mod, decides.
    expect(settled[0]).toMatchObject({
      mode: 'v1',
      reason: 'flag',
      installed: [],
    });
  });

  it('resolves nothing for a run without an integration', async () => {
    await expect(
      settleSdkCaptureModes(
        { installDir: '/tmp/none', integration: null, sdkCaptureModes: [] },
        on({}),
      ),
    ).resolves.toEqual([]);
  });
});

describe('sdkCaptureModeFacts: the v1 rules', () => {
  it('adds the four syntax-free v1 rules to a v1 line and nothing to a legacy one', async () => {
    const legacy = await withProject({}, (dir) =>
      detectSdkCaptureModes(dir, Integration.rust),
    );
    expect(sdkCaptureModeFacts({ sdkCaptureModes: legacy })[0]).not.toContain(
      'AI capture method',
    );
    const v1 = applySdkCaptureModeFlags(
      { integration: Integration.rust, sdkCaptureModes: legacy },
      { [WIZARD_SDK_CAPTURE_V1_FLAG_KEY]: { 'posthog-rs': 'v1' } },
    );
    const fact = sdkCaptureModeFacts({ sdkCaptureModes: v1 })[0];
    expect(fact).toContain('this run uses the 1.x line (capture v1 API)');
    expect(fact).toContain(
      "send every `$ai_*` event through the SDK's AI capture method",
    );
    expect(fact).toContain('never as a `$`-prefixed property');
    expect(fact).toContain(
      'a value set on the call beats a global, super or context value',
    );
    expect(fact).toContain('`before_send` hook must pass the event');
  });
});

describe('floors', () => {
  it('records the floor on the resolution and keeps it through the flag re-resolution', async () => {
    const detected = await withProject(
      { 'go.mod': 'module app\n\ngo 1.20\n' },
      (dir) => detectSdkCaptureModes(dir, Integration.go),
    );
    expect(detected[0]).toMatchObject({
      mode: 'legacy',
      reason: 'not-released',
      floor: { ok: false, reason: 'go.mod go directive 1.20 is below 1.21' },
    });
    // A tester opt-in to v1 still respects the floor, from the stored check.
    const forced = applySdkCaptureModeFlags(
      { integration: Integration.go, sdkCaptureModes: detected },
      { [WIZARD_SDK_CAPTURE_V1_FLAG_KEY]: { 'posthog-go': 'v1' } },
    );
    expect(forced[0]).toMatchObject({ mode: 'legacy', reason: 'floor' });
    expect(sdkCaptureModeFacts({ sdkCaptureModes: forced })[0]).toContain(
      'The project does not meet the 2.x floor: go.mod go directive 1.20 is below 1.21.',
    );
  });
});
