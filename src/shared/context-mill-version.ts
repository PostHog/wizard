/**
 * The context-mill release this process fetches skills from; unset follows the
 * latest. See docs/local-dev.md#pinning-a-context-mill-release.
 */

/** `1.59.0` or `v1.59.0`, with an optional prerelease. */
const RELEASE_VERSION = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/** Returns the release tag (`v1.59.0`), or undefined for empty and `latest`; throws on anything else, since the value becomes a URL path. */
export function parseContextMillVersion(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).trim();
  if (value === '' || value === 'latest') return undefined;
  const match = RELEASE_VERSION.exec(value);
  if (!match) {
    throw new Error(
      `Invalid context-mill version "${value}". Use a release version such as 1.59.0, or "latest".`,
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
