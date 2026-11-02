import { Integration, WIZARD_SDK_CAPTURE_V1_FLAG_KEY } from '@shared/constants';
import {
  parseSdkCaptureModeOverrides,
  resolveSdkCaptureMode,
  sdkCaptureModeOverridesFromPayloads,
  type SdkCaptureModeInput,
} from '@shared/sdk-capture-mode';
import { SDK_MAJORS } from '@shared/sdk-majors';

const legacyNode = { major: 5, version: '^5.60.0', source: 'package.json' };
const v1Node = { major: 6, version: '6.0.1', source: 'pnpm-lock.yaml' };

/** The table as if posthog-node's release day had happened. */
const RELEASED_NODE_TABLE = SDK_MAJORS.map((row) =>
  row.sdk === 'posthog-node' ? { ...row, v1Released: true } : row,
);

describe('parseSdkCaptureModeOverrides', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', '{"posthog-node":"v1"}'],
    ['an array', ['posthog-node']],
    ['an unrelated object', { model: 'sonnet', effort: 'high' }],
    ['unknown sdk ids', { 'posthog-js': 'v1' }],
    ['unknown values', { 'posthog-node': 'latest' }],
  ])('overrides nothing for %s', (_label, payload) => {
    expect(parseSdkCaptureModeOverrides(payload)).toEqual({});
  });

  it('keeps the valid entries and drops the rest', () => {
    expect(
      parseSdkCaptureModeOverrides({
        'posthog-node': 'legacy',
        'posthog-python': 'v1',
        'posthog-go': true,
        'posthog-js': 'legacy',
      }),
    ).toEqual({ 'posthog-node': 'legacy', 'posthog-python': 'v1' });
  });

  it('reads the payload under the flag key from a snapshot', () => {
    expect(
      sdkCaptureModeOverridesFromPayloads({
        [WIZARD_SDK_CAPTURE_V1_FLAG_KEY]: { 'posthog-rs': 'v1' },
        'wizard-orchestrator-override': { 'posthog-node': 'v1' },
      }),
    ).toEqual({ 'posthog-rs': 'v1' });
    expect(sdkCaptureModeOverridesFromPayloads(undefined)).toEqual({});
  });
});

describe('resolveSdkCaptureMode', () => {
  describe('installed SDK', () => {
    it('follows an installed legacy major whatever the flags and release state say', () => {
      const resolution = resolveSdkCaptureMode({
        sdk: 'posthog-node',
        installed: [legacyNode],
        flagPayload: { 'posthog-node': 'v1' },
      });
      expect(resolution).toMatchObject({
        mode: 'legacy',
        major: 5,
        reason: 'installed',
        detail: 'package.json',
      });
    });

    it('follows an installed v1 major before the row is released', () => {
      expect(
        resolveSdkCaptureMode({ sdk: 'posthog-node', installed: [v1Node] }),
      ).toMatchObject({ mode: 'v1', major: 6, reason: 'installed' });
    });

    it('reports a conflict when two copies disagree on the mode', () => {
      const resolution = resolveSdkCaptureMode({
        sdk: 'posthog-node',
        installed: [legacyNode, v1Node],
      });
      expect(resolution.mode).toBe('conflict');
      expect(resolution.reason).toBe('conflict');
      expect(resolution.installed).toEqual([legacyNode, v1Node]);
    });

    it('takes the highest major when the copies agree on the mode', () => {
      expect(
        resolveSdkCaptureMode({
          sdk: 'posthog-python',
          installed: [
            { major: 3, version: '>=3.0.0', source: 'requirements.txt' },
            { major: 7, version: '7.82.1', source: 'uv.lock' },
          ],
        }),
      ).toMatchObject({ mode: 'legacy', major: 7, reason: 'installed' });
    });
  });

  describe('fresh install before the release-day flip', () => {
    const fresh: SdkCaptureModeInput = { sdk: 'posthog-node' };

    it('pins legacy by default', () => {
      expect(resolveSdkCaptureMode(fresh)).toEqual({
        sdk: 'posthog-node',
        mode: 'legacy',
        major: 5,
        reason: 'not-released',
        installed: [],
      });
    });

    it('lets a tester opt into v1 through the flag', () => {
      expect(
        resolveSdkCaptureMode({
          ...fresh,
          flagPayload: { 'posthog-node': 'v1' },
        }),
      ).toMatchObject({ mode: 'v1', major: 6, reason: 'flag', detail: 'v1' });
    });

    it('still applies the floor and host checks to a tester opt-in', () => {
      expect(
        resolveSdkCaptureMode({
          ...fresh,
          flagPayload: { 'posthog-node': 'v1' },
          floor: { ok: false, reason: 'node<20.20' },
        }),
      ).toMatchObject({
        mode: 'legacy',
        reason: 'floor',
        detail: 'node<20.20',
      });
      expect(
        resolveSdkCaptureMode({
          ...fresh,
          flagPayload: { 'posthog-node': 'v1' },
          hostServesV1: false,
        }),
      ).toMatchObject({ mode: 'legacy', reason: 'host' });
    });

    it('keeps a server-rendered framework on legacy posthog-node even with the tester flag', () => {
      expect(
        resolveSdkCaptureMode({
          ...fresh,
          integration: Integration.nextjs,
          flagPayload: { 'posthog-node': 'v1' },
        }),
      ).toMatchObject({
        mode: 'legacy',
        reason: 'secondary-policy',
        detail: 'nextjs',
      });
    });

    it('ignores the secondary policy for the primary integration', () => {
      expect(
        resolveSdkCaptureMode({
          ...fresh,
          integration: Integration.javascriptNode,
        }),
      ).toMatchObject({ mode: 'legacy', reason: 'not-released' });
    });
  });

  describe('fresh install after the release-day flip', () => {
    it.each<[string, Partial<SdkCaptureModeInput>, Record<string, unknown>]>([
      ['defaults to v1', {}, { mode: 'v1', major: 6, reason: 'default' }],
      [
        'honours the legacy kill switch',
        { flagPayload: { 'posthog-node': 'legacy' } },
        { mode: 'legacy', major: 5, reason: 'flag', detail: 'legacy' },
      ],
      [
        'falls back to legacy when the floor fails',
        { floor: { ok: false, reason: 'node<20.20' } },
        { mode: 'legacy', reason: 'floor', detail: 'node<20.20' },
      ],
      [
        'passes a floor that is met',
        { floor: { ok: true } },
        { mode: 'v1', reason: 'default' },
      ],
      [
        'falls back to legacy when the host has no v1 routes',
        { hostServesV1: false },
        { mode: 'legacy', reason: 'host' },
      ],
      [
        'treats an unprobed host as serving v1',
        { hostServesV1: undefined },
        { mode: 'v1', reason: 'default' },
      ],
      [
        'keeps a server-rendered framework on legacy until its own flip',
        { integration: Integration.nuxt },
        { mode: 'legacy', reason: 'secondary-policy', detail: 'nuxt' },
      ],
    ])('%s', (_label, input, expected) => {
      expect(
        resolveSdkCaptureMode(
          { sdk: 'posthog-node', ...input },
          RELEASED_NODE_TABLE,
        ),
      ).toMatchObject(expected);
    });
  });

  it('applies the checks in order: flag, secondary policy, release, floor, host', () => {
    // Legacy flag outranks everything but an installed copy.
    expect(
      resolveSdkCaptureMode({
        sdk: 'posthog-node',
        integration: Integration.nextjs,
        flagPayload: { 'posthog-node': 'legacy' },
        floor: { ok: false, reason: 'x' },
        hostServesV1: false,
      }).reason,
    ).toBe('flag');
    // Secondary policy outranks the release state.
    expect(
      resolveSdkCaptureMode({
        sdk: 'posthog-node',
        integration: Integration.astro,
        floor: { ok: false, reason: 'x' },
      }).reason,
    ).toBe('secondary-policy');
    // Release state outranks the floor and host.
    expect(
      resolveSdkCaptureMode({
        sdk: 'posthog-node',
        floor: { ok: false, reason: 'x' },
        hostServesV1: false,
      }).reason,
    ).toBe('not-released');
  });
});
