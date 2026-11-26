import { normalizeGitRemote } from '../fingerprint';

/**
 * Package versions from `Package.swift`, by URL as `host/owner/repo`:
 * lowercased, with no scheme and no `.git`, e.g.
 * `github.com/getsentry/sentry-cocoa`. The version is the first one the
 * package names, such as `from: "3.0.0"`.
 */
export function parsePackageSwift(content: string): Record<string, string> {
  return Object.fromEntries(
    [...content.matchAll(/\burl\s*:\s*"([^"]+)"(?:[^")]*?"(\d[^"]*)")?/g)].map(
      (m) => [normalizeGitRemote(m[1]), m[2] ?? ''],
    ),
  );
}
