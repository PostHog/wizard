import { major, minVersion } from 'semver';

/**
 * Get TanStack Start version bucket for analytics
 */
export function getTanStackStartVersionBucket(
  version: string | undefined,
): string {
  if (!version) {
    return 'none';
  }

  try {
    const minVer = minVersion(version);
    if (!minVer) {
      return 'invalid';
    }
    const majorVersion = major(minVer);
    return `${majorVersion}.x`;
  } catch {
    return 'unknown';
  }
}
