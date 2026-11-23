import { normalizeGitRemote } from '../fingerprint';

/**
 * Package URLs from `Package.swift`, as `host/owner/repo`: lowercased, with no
 * scheme and no `.git`, e.g. `github.com/getsentry/sentry-cocoa`.
 */
export function parsePackageSwift(content: string): string[] {
  return [...content.matchAll(/\burl\s*:\s*"([^"]+)"/g)].map((m) =>
    normalizeGitRemote(m[1]),
  );
}
