import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';

/** Pi's own auto-retry events, the only retry a Pi turn gets. */
export type AutoRetryEvent =
  | {
      type: 'auto_retry_start';
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | {
      type: 'auto_retry_end';
      success: boolean;
      attempt: number;
      finalError?: string;
    };

/** Logs and captures each Pi auto-retry, and error-tracks the ones that give up. */
export function trackAutoRetry(event: AutoRetryEvent, tag: string): void {
  if (event.type === 'auto_retry_start') {
    logToFile(
      `[${tag}] turn failed (${event.errorMessage}); pi retry ${event.attempt}/${event.maxAttempts} in ${event.delayMs}ms`,
    );
    analytics.wizardCapture('agent turn retried', {
      harness: 'pi',
      attempt: event.attempt,
      max_attempts: event.maxAttempts,
      error: event.errorMessage.slice(0, 300),
    });
    return;
  }
  logToFile(
    `[${tag}] pi retry ${event.success ? 'recovered' : 'gave up'} after ${
      event.attempt
    } attempt(s)`,
  );
  if (!event.success) {
    analytics.captureException(
      new Error(event.finalError ?? 'Pi auto-retry gave up'),
      { step: 'pi_auto_retry', harness: 'pi', attempts: event.attempt },
    );
  }
}
