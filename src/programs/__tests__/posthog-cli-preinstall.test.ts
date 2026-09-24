import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  preinstallPostHogCliOnce,
  resetPostHogCliPreinstallForTests,
} from '@programs/shared/posthog-cli-preinstall';
import { installOrUpdatePostHogCli } from '@steps/install-cli-steering';
import { analytics } from '@utils/analytics';

vi.mock('@steps/install-cli-steering', () => ({
  installOrUpdatePostHogCli: vi.fn(),
}));
vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));
const warn = vi.fn();

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
      warn,
    );
    preinstallPostHogCliOnce(
      'error tracking posthog-cli preinstall failed',
      { integration: 'swift' },
      warn,
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
      warn,
    );

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'error tracking posthog-cli preinstall failed',
      { integration: 'swift', error: 'EACCES' },
    );
    expect(analytics.captureException).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
  });

  test('a successful install stays silent', () => {
    vi.mocked(installOrUpdatePostHogCli).mockReturnValue({ success: true });

    preinstallPostHogCliOnce(
      'error tracking posthog-cli preinstall failed',
      { integration: 'swift' },
      warn,
    );

    expect(analytics.wizardCapture).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
