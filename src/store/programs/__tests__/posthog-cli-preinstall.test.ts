import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  preinstallPostHogCliOnce,
  resetPostHogCliPreinstallForTests,
} from '../shared/posthog-cli-preinstall.js';
import { installOrUpdatePostHogCli } from '../../services/steps/install-cli-steering/index.js';
import { getUI } from '../../ui/index.js';
import { analytics } from '../../shared/analytics.js';

vi.mock('../../services/steps/install-cli-steering/index.js', () => ({
  installOrUpdatePostHogCli: vi.fn(),
}));
vi.mock('../../shared/analytics.js', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));
vi.mock('../../ui/index.js', () => ({ getUI: vi.fn() }));

const warn = vi.fn();

describe('preinstallPostHogCliOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPostHogCliPreinstallForTests();
    vi.mocked(getUI).mockReturnValue({ log: { warn } } as never);
  });

  test('installs at most once per process, whichever program calls', () => {
    vi.mocked(installOrUpdatePostHogCli).mockReturnValue({ success: true });

    preinstallPostHogCliOnce('source maps posthog-cli preinstall failed', {
      variant: 'ios',
    });
    preinstallPostHogCliOnce('error tracking posthog-cli preinstall failed', {
      integration: 'swift',
    });

    expect(installOrUpdatePostHogCli).toHaveBeenCalledTimes(1);
  });

  test('a failed install is an event and a warning, never an exception', () => {
    vi.mocked(installOrUpdatePostHogCli).mockReturnValue({
      success: false,
      error: 'EACCES',
    });

    preinstallPostHogCliOnce('error tracking posthog-cli preinstall failed', {
      integration: 'swift',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'error tracking posthog-cli preinstall failed',
      { integration: 'swift', error: 'EACCES' },
    );
    expect(analytics.captureException).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
  });

  test('a successful install stays silent', () => {
    vi.mocked(installOrUpdatePostHogCli).mockReturnValue({ success: true });

    preinstallPostHogCliOnce('error tracking posthog-cli preinstall failed', {
      integration: 'swift',
    });

    expect(analytics.wizardCapture).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
