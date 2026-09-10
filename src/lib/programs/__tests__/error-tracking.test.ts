import { describe, expect, test } from 'vitest';

import { Integration } from '@lib/constants';
import {
  errorTrackingConfig,
  SYMBOL_UPLOAD_CLI_FRAMEWORKS,
} from '@lib/programs/error-tracking/index';

describe('error-tracking program', () => {
  test('runs the error-tracking agent flow', () => {
    expect(errorTrackingConfig.agentFlow).toBe('error-tracking');
  });

  test('detects the framework before the agent-skill steps', () => {
    expect(errorTrackingConfig.steps[0]?.id).toBe('detect');
    expect(errorTrackingConfig.steps[0]?.onReady).toBeDefined();
  });

  test('declares ci prerequisite work for headless runs', () => {
    expect(errorTrackingConfig.ciPreRun).toBeDefined();
  });

  test('shows the program-specific intro screen', () => {
    const intro = errorTrackingConfig.steps.find((s) => s.id === 'intro');
    expect(intro?.screenId).toBe('error-tracking-intro');
  });

  test('pre-installs no skill — the flow resolves variants per framework', () => {
    // There is no bare `error-tracking` menu entry; a seeded skillId would
    // send the linear path to a skill-not-found abort and mislead the intro.
    expect(errorTrackingConfig.skillId).toBeUndefined();
    expect(errorTrackingConfig.run).toBeDefined();
    if (
      errorTrackingConfig.run &&
      typeof errorTrackingConfig.run !== 'function'
    ) {
      expect(errorTrackingConfig.run.skillId).toBeUndefined();
    }
  });
});

describe('error-tracking posthog-cli pre-install set', () => {
  test('contains only real Integration values', () => {
    for (const integration of SYMBOL_UPLOAD_CLI_FRAMEWORKS) {
      expect(Object.values(Integration)).toContain(integration);
    }
  });

  test('covers the symbol-upload platforms and no web ones', () => {
    // Keep in lockstep with VARIANTS_REQUIRING_POSTHOG_CLI in the source-maps
    // program: their builds shell out to a machine-global posthog-cli.
    expect(SYMBOL_UPLOAD_CLI_FRAMEWORKS.has(Integration.swift)).toBe(true);
    expect(SYMBOL_UPLOAD_CLI_FRAMEWORKS.has(Integration.android)).toBe(true);
    expect(SYMBOL_UPLOAD_CLI_FRAMEWORKS.has(Integration.reactNative)).toBe(
      true,
    );
    expect(SYMBOL_UPLOAD_CLI_FRAMEWORKS.has(Integration.flutter)).toBe(true);
    expect(SYMBOL_UPLOAD_CLI_FRAMEWORKS.has(Integration.go)).toBe(true);
    expect(SYMBOL_UPLOAD_CLI_FRAMEWORKS.has(Integration.rust)).toBe(true);
    expect(SYMBOL_UPLOAD_CLI_FRAMEWORKS.has(Integration.nextjs)).toBe(false);
    expect(SYMBOL_UPLOAD_CLI_FRAMEWORKS.has(Integration.javascript_web)).toBe(
      false,
    );
  });
});
