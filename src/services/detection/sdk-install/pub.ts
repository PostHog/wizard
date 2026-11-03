import * as path from 'path';
import { readProjectFile } from '@utils/bounded-fs';
import type { InstalledSdk } from '@shared/sdk-capture-mode';
import { dedupeInstalled, LOCKFILE_MAX_BYTES } from './types';
import {
  isUnboundedRequirement,
  lowerBoundMajor,
  majorOfVersion,
} from './version-spec';

const PUB_PACKAGE = 'posthog_flutter';

/** The lock lists each package as a two-space key with its fields indented four. */
function readPubspecLock(content: string): InstalledSdk[] {
  const block = new RegExp(`^  ${PUB_PACKAGE}:\\s*$((?:\\n {4}.*)*)`, 'm').exec(
    content,
  )?.[1];
  const version = block
    ? /^\s{4}version:\s*"?([^"\s]+)"?/m.exec(block)?.[1]
    : undefined;
  const major = version === undefined ? undefined : majorOfVersion(version);
  return version !== undefined && major !== undefined
    ? [{ major, version, source: 'pubspec.lock' }]
    : [];
}

/** `posthog_flutter: ^5.58.4`; a mapping value (git or path source) carries no version. */
function readPubspec(content: string): InstalledSdk[] {
  const match = new RegExp(`^\\s+${PUB_PACKAGE}:\\s*([^\\s#]+)`, 'm').exec(
    content,
  );
  const major = match ? lowerBoundMajor(match[1]) : undefined;
  return match && major !== undefined
    ? [
        {
          major,
          version: match[1],
          source: 'pubspec.yaml',
          ...(isUnboundedRequirement(match[1]) ? { unbounded: true } : {}),
        },
      ]
    : [];
}

export function readPubInstalls(installDir: string): InstalledSdk[] {
  const lock = readProjectFile(
    path.join(installDir, 'pubspec.lock'),
    LOCKFILE_MAX_BYTES,
  );
  if (lock !== null) {
    const copies = dedupeInstalled(readPubspecLock(lock));
    if (copies.length > 0) return copies;
  }
  const manifest = readProjectFile(path.join(installDir, 'pubspec.yaml'));
  return manifest === null ? [] : dedupeInstalled(readPubspec(manifest));
}
