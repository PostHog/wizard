import { analytics } from './analytics';

/** Deliver the pending analytics events before the process exits; a failed flush never changes the outcome. */
export async function flushAnalytics(): Promise<void> {
  try {
    await analytics.flush();
  } catch {
    // best-effort
  }
}
