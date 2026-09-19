import { analytics } from '@store/shared/analytics';

export function withProgress<T>(step: string, callback: () => T): T {
  updateProgress(step);
  return callback();
}

export function updateProgress(step: string) {
  analytics.setTag('progress', step);
}
