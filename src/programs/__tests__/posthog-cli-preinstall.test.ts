import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  preinstallPostHogCliOnce,
  resetPostHogCliPreinstallForTests,
} from '@programs/shared/posthog-cli-preinstall';
import { installOrUpdatePostHogCli } from '@shared/install-cli-steering';
import { Integration } from '@shared/constants';
import { analytics } from '@utils/analytics';
import { SYMBOL_UPLOAD_CLI_FRAMEWORKS } from '@programs/error-tracking';
import { VARIANTS_REQUIRING_POSTHOG_CLI } from '@programs/error-tracking-upload-source-maps';

vi.mock(import('@shared/install-cli-steering'), () => ({
  installOrUpdatePostHogCli: vi.fn(),
}));
vi.mock(import('@utils/analytics'), () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() } as never,
}));
const log = { warn: vi.fn() };

describe('preinstallPostHogCliOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPostHogCliPreinstallForTests();
  });

  test('installs at most once per process, whichever program calls', () => {
    vi.mocked(installOrUpdatePostHogCli).mockReturnValue({ success: true });

    preinstallPostHogCliOnce(
      'source maps posthog-cli preinstall failed',
      { variant: 'ios' },
      log,
    );
    preinstallPostHogCliOnce(
      'error tracking posthog-cli preinstall failed',
      { integration: 'swift' },
      log,
    );

    expect(installOrUpdatePostHogCli).toHaveBeenCalledTimes(1);
  });

  test('a failed install is an event and a warning, never an exception', () => {
    vi.mocked(installOrUpdatePostHogCli).mockReturnValue({
      success: false,
      error: 'EACCES',
    });

    preinstallPostHogCliOnce(
      'error tracking posthog-cli preinstall failed',
      { integration: 'swift' },
      log,
    );

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'error tracking posthog-cli preinstall failed',
      { integration: 'swift', error: 'EACCES' },
    );
    expect(analytics.captureException).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
  });

  test('a successful install stays silent', () => {
    vi.mocked(installOrUpdatePostHogCli).mockReturnValue({ success: true });

    preinstallPostHogCliOnce(
      'error tracking posthog-cli preinstall failed',
      { integration: 'swift' },
      log,
    );

    expect(analytics.wizardCapture).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('the two programs that pre-install posthog-cli', () => {
  test('error tracking matches the source-maps program set, keyed by Integration', () => {
    // Both programs pre-install the CLI for the same platforms. The source-maps
    // program keys them by uploader variant, and only `ios` is spelled
    // differently (`swift` in Integration).
    const expected = [...VARIANTS_REQUIRING_POSTHOG_CLI]
      .map((variant) => (variant === 'ios' ? Integration.swift : variant))
      .sort();
    expect([...SYMBOL_UPLOAD_CLI_FRAMEWORKS].sort()).toEqual(expected);
  });
});
