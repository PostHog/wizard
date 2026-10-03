import { describe, expect, test } from 'vitest';

import { Integration, REPLAY_VISION_SUPPORTED } from '@shared/constants';

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
