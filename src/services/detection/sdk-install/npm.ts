import * as path from 'path';
import { readProjectFile } from '@utils/bounded-fs';
import type { InstalledSdk } from '@shared/sdk-capture-mode';
import type { PackageJson } from '@utils/package-json';
import { getDeclaredVersion } from '@utils/package-json';
import { dedupeInstalled, LOCKFILE_MAX_BYTES } from './types';
import {
  isUnboundedRequirement,
  lowerBoundMajor,
  majorOfVersion,
} from './version-spec';

const NPM_PACKAGE = 'posthog-node';

function escape(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function fromVersions(
  versions: Iterable<string>,
  source: string,
): InstalledSdk[] {
  const copies: InstalledSdk[] = [];
  for (const version of versions) {
    const major = majorOfVersion(version);
    if (major !== undefined) copies.push({ major, version, source });
  }
  return copies;
}

/** npm lockfile v1 nests copies under `dependencies`; v2 and v3 flatten them under `packages`. */
function readPackageLock(content: string): InstalledSdk[] {
  const lock = JSON.parse(content) as {
    packages?: Record<string, { version?: string }>;
    dependencies?: Record<string, LockDependency>;
  };
  const copies: InstalledSdk[] = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.endsWith(`node_modules/${NPM_PACKAGE}`) || !entry.version)
      continue;
    const major = majorOfVersion(entry.version);
    if (major !== undefined) {
      copies.push({
        major,
        version: entry.version,
        source: `package-lock.json (${key})`,
      });
    }
  }
  if (copies.length === 0 && lock.dependencies) {
    walkLockDependencies(lock.dependencies, 'package-lock.json', copies);
  }
  return copies;
}

type LockDependency = {
  version?: string;
  dependencies?: Record<string, LockDependency>;
};

function walkLockDependencies(
  dependencies: Record<string, LockDependency>,
  source: string,
  copies: InstalledSdk[],
): void {
  for (const [name, entry] of Object.entries(dependencies)) {
    if (name === NPM_PACKAGE && entry.version) {
      const major = majorOfVersion(entry.version);
      if (major !== undefined) {
        copies.push({ major, version: entry.version, source });
      }
    }
    if (entry.dependencies) {
      walkLockDependencies(entry.dependencies, `${source} (${name})`, copies);
    }
  }
}

/** `packages:` and `snapshots:` keys look like `posthog-node@5.60.0:`, `/posthog-node@5.60.0:` (v6) or `/posthog-node/5.60.0:` (v5). */
function readPnpmLock(content: string): InstalledSdk[] {
  const pattern = new RegExp(
    `^\\s*'?/?${escape(NPM_PACKAGE)}[@/](\\d+\\.\\d+\\.\\d+[^:'(\\s]*)'?[:(]`,
    'gm',
  );
  const versions = new Set<string>();
  for (const match of content.matchAll(pattern)) versions.add(match[1]);
  return fromVersions(versions, 'pnpm-lock.yaml');
}

/** Classic yarn writes `posthog-node@^5.60.0:` then `version "5.60.0"`; berry writes `"posthog-node@npm:^5.60.0":` then `version: 5.60.0`. */
function readYarnLock(content: string): InstalledSdk[] {
  const versions = new Set<string>();
  const header = new RegExp(`(^|[",\\s])${escape(NPM_PACKAGE)}@`);
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s/.test(line) || !line.endsWith(':') || !header.test(line)) continue;
    for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j += 1) {
      const match = /^\s+version:?\s+"?([^"\s]+)"?/.exec(lines[j]);
      if (match) {
        versions.add(match[1]);
        break;
      }
    }
  }
  return fromVersions(versions, 'yarn.lock');
}

/** The text lockfile pins each copy as `"posthog-node@5.60.0"`. */
function readBunLock(content: string): InstalledSdk[] {
  const pattern = new RegExp(
    `"${escape(NPM_PACKAGE)}@(\\d+\\.\\d+\\.\\d+[^"]*)"`,
    'g',
  );
  const versions = new Set<string>();
  for (const match of content.matchAll(pattern)) versions.add(match[1]);
  return fromVersions(versions, 'bun.lock');
}

const LOCKFILES: ReadonlyArray<[string, (content: string) => InstalledSdk[]]> =
  [
    ['package-lock.json', readPackageLock],
    ['pnpm-lock.yaml', readPnpmLock],
    ['yarn.lock', readYarnLock],
    ['bun.lock', readBunLock],
  ];

export function readNpmInstalls(installDir: string): InstalledSdk[] {
  for (const [file, parse] of LOCKFILES) {
    const content = readProjectFile(
      path.join(installDir, file),
      LOCKFILE_MAX_BYTES,
    );
    if (content === null) continue;
    try {
      const copies = dedupeInstalled(parse(content));
      if (copies.length > 0) return copies;
    } catch {
      // A malformed lockfile falls through to the manifest.
    }
  }
  const manifest = readProjectFile(path.join(installDir, 'package.json'));
  if (manifest === null) return [];
  try {
    const declared = getDeclaredVersion(
      NPM_PACKAGE,
      JSON.parse(manifest) as PackageJson,
    );
    if (!declared) return [];
    const major = lowerBoundMajor(declared);
    return major === undefined
      ? []
      : [
          {
            major,
            version: declared,
            source: 'package.json',
            ...(isUnboundedRequirement(declared) ? { unbounded: true } : {}),
          },
        ];
  } catch {
    return [];
  }
}
