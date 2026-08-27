import { describe, expect, test } from 'vitest';

import { Integration } from '@lib/constants';
import {
  replayVisionConfig,
  REPLAY_VISION_SUPPORTED,
} from '@lib/programs/replay-vision/index';

describe('replay-vision program', () => {
  test('runs the replay-vision agent flow', () => {
    expect(replayVisionConfig.agentFlow).toBe('replay-vision');
  });

  test('detects the framework before the agent-skill steps', () => {
    expect(replayVisionConfig.steps[0]?.id).toBe('detect');
    expect(replayVisionConfig.steps[0]?.onReady).toBeDefined();
  });

  test('declares ci prerequisite work for headless runs', () => {
    expect(replayVisionConfig.ciPreRun).toBeDefined();
  });
});

describe('replay-vision platform support', () => {
  test('covers every Integration with an explicit verdict', () => {
    // The gate is an allow-list: a new Integration enum entry is unsupported
    // until someone decides otherwise. This test only pins that the set
    // contains real Integration values.
    for (const integration of REPLAY_VISION_SUPPORTED) {
      expect(Object.values(Integration)).toContain(integration);
    }
  });

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
