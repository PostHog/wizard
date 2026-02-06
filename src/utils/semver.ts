import {
  major,
  minVersion,
  satisfies,
  subset,
  valid,
  validRange,
} from 'semver';

export function fulfillsVersionRange({
  version,
  acceptableVersions,
  canBeLatest,
}: {
  version: string;
  acceptableVersions: string;
  canBeLatest: boolean;
}): boolean {
  if (version === 'latest') {
    return canBeLatest;
  }

  let cleanedUserVersion, isRange;

  if (valid(version)) {
    cleanedUserVersion = valid(version);
    isRange = false;
  } else if (validRange(version)) {
    cleanedUserVersion = validRange(version);
    isRange = true;
  }

  return (
    // If the given version is a bogus format, this will still be undefined and we'll automatically reject it
    !!cleanedUserVersion &&
    (isRange
      ? subset(cleanedUserVersion, acceptableVersions)
      : satisfies(cleanedUserVersion, acceptableVersions))
  );
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
