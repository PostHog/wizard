import { existsSync, statSync } from 'fs';
import { findPackageJsons } from '@programs/shared/package-scanning';

export type WebAnalyticsDetectError =
  | {
      kind: 'bad-directory';
      path: string;
      reason: 'missing' | 'not-dir' | 'unreadable';
    }
  | { kind: 'no-package-json' }
  | { kind: 'no-posthog'; scannedCount: number };

export { WEB_ANALYTICS_ABORT_CASES } from './run.js';

export function detectWebAnalyticsPrerequisites(
  session: { installDir: string },
  setFrameworkContext: (key: string, value: unknown) => void,
): void {
  const fail = (error: WebAnalyticsDetectError) =>
    setFrameworkContext('detectError', error);

  const installDir = session.installDir;

  if (!existsSync(installDir)) {
    fail({ kind: 'bad-directory', path: installDir, reason: 'missing' });
    return;
  }
  try {
    if (!statSync(installDir).isDirectory()) {
      fail({ kind: 'bad-directory', path: installDir, reason: 'not-dir' });
      return;
    }
  } catch {
    fail({ kind: 'bad-directory', path: installDir, reason: 'unreadable' });
    return;
  }

  const matches = findPackageJsons(installDir);

  if (matches.length === 0) {
    fail({ kind: 'no-package-json' });
    return;
  }

  const sdks = [...new Set(matches.flatMap((m) => m.posthogSdks))];

  if (sdks.length === 0) {
    fail({ kind: 'no-posthog', scannedCount: matches.length });
    return;
  }

  setFrameworkContext('detectedPosthogSdks', sdks);
}
