import type { InstalledSdk } from '@shared/sdk-capture-mode';

/** Lockfiles are line-oriented and large in monorepos; the project-file cap would skip them silently. */
export const LOCKFILE_MAX_BYTES = 32 * 1024 * 1024;

/** One ecosystem's lookup: lockfiles first, the manifest second. */
export type InstalledSdkReader = (
  installDir: string,
) => InstalledSdk[] | Promise<InstalledSdk[]>;

/** Drops repeated copies that one file lists more than once. */
export function dedupeInstalled(copies: InstalledSdk[]): InstalledSdk[] {
  const seen = new Set<string>();
  return copies.filter((copy) => {
    const key = `${copy.version}@${copy.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
