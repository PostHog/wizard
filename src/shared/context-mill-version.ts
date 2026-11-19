/**
 * The context-mill release this process fetches skills from; unset follows the
 * latest. See docs/local-dev.md#pinning-a-context-mill-release.
 */

/** `1.67.0` or `v1.67.0`, with an optional prerelease. */
const RELEASE_VERSION = /^v?((\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?)$/;

/** The oldest release whose menu lists every skill as its own entry. */
const CONTEXT_MILL_FLOOR = '1.67.0';

const FLOOR_PARTS = CONTEXT_MILL_FLOOR.split('.').map(Number);

/** Whether a release is older than the floor; a prerelease of the floor comes before it. */
function belowFloor(parts: readonly number[], prerelease: boolean): boolean {
  for (let i = 0; i < FLOOR_PARTS.length; i++) {
    if (parts[i] !== FLOOR_PARTS[i]) return parts[i] < FLOOR_PARTS[i];
  }
  return prerelease;
}

/** Returns the release tag (`v1.67.0`), or undefined for empty and `latest`; throws on anything else, since the value becomes a URL path, and on a release older than the floor. */
export function parseContextMillVersion(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).trim();
  if (value === '' || value === 'latest') return undefined;
  const match = RELEASE_VERSION.exec(value);
  if (!match) {
    throw new Error(
      `Invalid context-mill version "${value}". Use a release version such as ${CONTEXT_MILL_FLOOR}, or "latest".`,
    );
  }
  const parts = [Number(match[2]), Number(match[3]), Number(match[4])];
  if (belowFloor(parts, match[5] !== undefined)) {
    throw new Error(
      `context-mill ${match[1]} is older than ${CONTEXT_MILL_FLOOR}, the oldest release this wizard can read. Use ${CONTEXT_MILL_FLOOR} or later, or "latest".`,
    );
  }
  return `v${match[1]}`;
}

let pinned: string | undefined;

/** Called once from the yargs middleware, which covers the flag and the env var; a caller with no CLI parse calls it directly. */
export function initContextMillVersion(raw: unknown): string | undefined {
  pinned = parseContextMillVersion(raw);
  return pinned;
}

/** The pinned release tag, or undefined when this run follows the latest release. */
export function getContextMillVersion(): string | undefined {
  return pinned;
}

/** Tests only. */
export function resetContextMillVersion(): void {
  pinned = undefined;
}
