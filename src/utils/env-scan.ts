/**
 * Project-wide `.env` KEY-NAME scanning — the single source of truth for
 * "which env keys does this project define, and in which file".
 *
 * Two surfaces read env keys and they must agree:
 *  - the warehouse-source detector (`@lib/warehouse-sources/detect`), which
 *    turns key names into detected sources, and
 *  - the `check_env_keys` wizard tool, which answers the agent's
 *    "is this key already set?" question.
 *
 * When they disagreed, the detector reported a source from
 * `apps/api/.env.local` while the tool looked only in `.env` and answered
 * "missing" — so the agent abandoned the setup. Both now share the walk, the
 * bounds, and the parser below.
 *
 * SECURITY: this module reads KEY NAMES only. A `.env` VALUE is never
 * returned, logged, or retained. Do not add a code path that does.
 */

import path from 'path';
import { walkProjectFiles, safeReadFile } from './bounded-fs';

/**
 * Directory levels below the install dir that an env scan descends. Bounds the
 * worst case on a large monorepo while still reaching `apps/<name>/.env.local`.
 */
export const ENV_SCAN_MAX_DEPTH = 3;

/** A scan retains at most this many distinct key names. */
export const MAX_ENV_KEY_SET = 5_000;

/** Files whose names start with `.env` carry env keys (`.env.local`, `.env.production`, …). */
export function isEnvFileName(name: string): boolean {
  return name.startsWith('.env');
}

/**
 * Extract KEY NAMES from a dotenv file's content. Values are intentionally
 * discarded — the right-hand side of `=` is never captured.
 *
 * Handles the `export KEY=value` form, skips comments and blank lines, and
 * tolerates whitespace around the key.
 */
export function parseEnvKeyNames(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

/**
 * Path of `fullPath` relative to `rootDir`, with `/` separators so the string
 * is stable across platforms when it reaches a prompt or a tool result.
 */
export function toRelativePosixPath(rootDir: string, fullPath: string): string {
  return path.relative(rootDir, fullPath).split(path.sep).join('/');
}

/** Key name → the project-relative env files that define it, in walk order. */
export type EnvKeyLocations = Map<string, string[]>;

/**
 * Walk `rootDir` for `.env*` files and map every key NAME to the files that
 * define it. Reuses `walkProjectFiles`, so the ignored-directory set, the
 * symlink-loop protection, and the per-walk caps all apply unchanged.
 *
 * A missing or unreadable directory yields an empty map — this is best-effort,
 * never throwing.
 */
export function collectProjectEnvKeys(rootDir: string): EnvKeyLocations {
  const locations: EnvKeyLocations = new Map();

  walkProjectFiles(
    rootDir,
    (name, fullPath) => {
      if (!isEnvFileName(name)) return;
      // null when unreadable or oversized — e.g. a `.env` that is a directory.
      const content = safeReadFile(fullPath);
      if (content === null) return;

      const relative = toRelativePosixPath(rootDir, fullPath);
      for (const key of parseEnvKeyNames(content)) {
        const existing = locations.get(key);
        if (existing) {
          if (!existing.includes(relative)) existing.push(relative);
        } else if (locations.size < MAX_ENV_KEY_SET) {
          locations.set(key, [relative]);
        }
      }
    },
    ENV_SCAN_MAX_DEPTH,
  );

  return locations;
}
