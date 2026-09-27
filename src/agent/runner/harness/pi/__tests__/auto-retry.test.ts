import { analytics } from '@utils/analytics';
import { trackAutoRetry } from '../auto-retry';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));
vi.mock('@utils/debug', () => ({ logToFile: vi.fn() }));

describe('trackAutoRetry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('captures each pi retry with its attempt and error', () => {
    trackAutoRetry(
      {
        type: 'auto_retry_start',
        attempt: 1,
        maxAttempts: 3,
        delayMs: 2000,
        errorMessage: 'upstream connection lost',
      },
      'pi',
    );
    expect(analytics.wizardCapture).toHaveBeenCalledWith('agent turn retried', {
      harness: 'pi',
      attempt: 1,
      max_attempts: 3,
      error: 'upstream connection lost',
    });
  });

  it('does not error-track a retry the user cancelled', () => {
    trackAutoRetry(
      {
        type: 'auto_retry_end',
        success: false,
        attempt: 1,
        finalError: 'Retry cancelled',
      },
      'pi',
    );
    expect(analytics.captureException).not.toHaveBeenCalled();
  });

  it('error-tracks a retry that gave up, and not one that recovered', () => {
    trackAutoRetry({ type: 'auto_retry_end', success: true, attempt: 1 }, 'pi');
    expect(analytics.captureException).not.toHaveBeenCalled();

    trackAutoRetry(
      {
        type: 'auto_retry_end',
        success: false,
        attempt: 3,
        finalError: 'upstream connection lost',
      },
      'pi',
    );
    expect(analytics.captureException).toHaveBeenCalledWith(
      new Error('upstream connection lost'),
      { step: 'pi_auto_retry', harness: 'pi', attempts: 3 },
    );
  });
});
