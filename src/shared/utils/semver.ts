import {
  major,
  minVersion,
  satisfies,
  subset,
  valid,
  validRange,
} from 'semver';

/**
 * Version strings from package.json that are not semver ranges.
 * URLs, git refs, dist-tags, local paths, workspace protocol, npm aliases, etc.
 * These should be rejected early — we can't determine a clear version from them.
 */
function isNonSemverVersion(version: string): boolean {
  const v = version.trim();
  return (
    v === '' ||
    v.startsWith('http://') ||
    v.startsWith('https://') ||
    v.startsWith('git+') ||
    v.startsWith('git://') ||
    v.startsWith('file:') ||
    v.startsWith('npm:') ||
    v.startsWith('workspace:') ||
    v.startsWith('/') ||
    v.includes('/') // user/repo shorthand
  );
}

export function versionSatisfiesRange({
  version,
  acceptableVersions,
  canBeLatest,
}: {
  version: string;
  acceptableVersions: string;
  canBeLatest: boolean;
}): boolean {
  if (version === 'latest') return canBeLatest;
  if (isNonSemverVersion(version)) return false;

  const concrete = valid(version);
  if (concrete !== null) {
    return satisfies(concrete, acceptableVersions);
  }

  const userRange = validRange(version);
  if (userRange === null) return false;
  return subset(userRange, acceptableVersions);
}

/** The one major every version in `range` has, or undefined when the range spans several or is not semver. */
export function rangeMajor(range: string): number | undefined {
  if (isNonSemverVersion(range)) return undefined;
  const normalized = validRange(range);
  const min = normalized === null ? null : minVersion(normalized);
  if (normalized === null || !min) return undefined;
  const sameMajor = `>=${min.major}.0.0-0 <${min.major + 1}.0.0`;
  return subset(normalized, sameMajor, { includePrerelease: true })
    ? min.major
    : undefined;
}

/**
 * Creates a version bucket function for analytics.
 * Converts versions like "1.2.3" to "1.x" for grouping in analytics.
 *
 * @param minMajorVersion - Optional minimum major version threshold.
 *   Versions below this will be bucketed as "<{min}.0.0"
 *
 * @example
 * const getVersionBucket = createVersionBucket(); // no minimum
 * getVersionBucket("1.2.3") // "1.x"
 *
 * const getVersionBucket = createVersionBucket(11);
 * getVersionBucket("15.3.0") // "15.x"
 * getVersionBucket("10.0.0") // "<11.0.0"
 */
export function createVersionBucket(minMajorVersion?: number) {
  return (version: string | undefined): string => {
    if (!version) {
      return 'none';
    }

    if (isNonSemverVersion(version)) {
      return 'unknown';
    }

    try {
      const minVer = minVersion(version);
      if (!minVer) {
        return 'invalid';
      }
      const majorVersion = major(minVer);
      if (minMajorVersion !== undefined && majorVersion < minMajorVersion) {
        return `<${minMajorVersion}.0.0`;
      }
      return `${majorVersion}.x`;
    } catch {
      return 'unknown';
    }
  };
}
