import { describe, expect, test } from 'vitest';

import type { ProgramRun } from '@programs/program-contract';
import { config as replayVision } from '@programs/replay-vision';
import type { Credentials } from '@shared/api';
import { Integration, REPLAY_VISION_SUPPORTED } from '@shared/constants';

describe('replay-vision outro next steps', () => {
  test('link the replay setting and the scanners in the run project', () => {
    const run = replayVision.run as ProgramRun;
    const credentials = {
      host: { appHost: 'https://us.posthog.com/' },
      projectId: 42,
    } as unknown as Credentials;

    const items = run.buildOutroNextSteps!(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      credentials,
      [],
    )!.items;

    expect(items).toContain(
      'Check that "Record user sessions" is on: https://us.posthog.com/project/42/settings/environment-replay',
    );
    expect(items).toContain(
      'See your scanners: https://us.posthog.com/project/42/replay-vision',
    );
  });
});

describe('replay-vision platform support', () => {
  test('supports web and replay-capable mobile platforms', () => {
    expect(REPLAY_VISION_SUPPORTED.has(Integration.nextjs)).toBe(true);
    expect(REPLAY_VISION_SUPPORTED.has(Integration.javascript_web)).toBe(true);
    expect(REPLAY_VISION_SUPPORTED.has(Integration.reactNative)).toBe(true);
    expect(REPLAY_VISION_SUPPORTED.has(Integration.android)).toBe(true);
    expect(REPLAY_VISION_SUPPORTED.has(Integration.swift)).toBe(true);
    expect(REPLAY_VISION_SUPPORTED.has(Integration.flutter)).toBe(true);
  });

  test('rejects platforms replay cannot record on', () => {
    expect(REPLAY_VISION_SUPPORTED.has(Integration.javascriptNode)).toBe(false);
    expect(REPLAY_VISION_SUPPORTED.has(Integration.python)).toBe(false);
    expect(REPLAY_VISION_SUPPORTED.has(Integration.ruby)).toBe(false);
    expect(REPLAY_VISION_SUPPORTED.has(Integration.kmp)).toBe(false);
  });
});
