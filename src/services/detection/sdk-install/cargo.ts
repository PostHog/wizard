import * as path from 'path';
import { readProjectFile } from '@utils/bounded-fs';
import type { InstalledSdk } from '@shared/sdk-capture-mode';
import { dedupeInstalled, LOCKFILE_MAX_BYTES } from './types';
import {
  isUnboundedRequirement,
  lowerBoundMajor,
  majorOfVersion,
} from './version-spec';

const CRATE = 'posthog-rs';

function readCargoLock(content: string): InstalledSdk[] {
  const copies: InstalledSdk[] = [];
  for (const block of content.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    if (/^name\s*=\s*"([^"]+)"/m.exec(block)?.[1] !== CRATE) continue;
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const major = version === undefined ? undefined : majorOfVersion(version);
    if (version !== undefined && major !== undefined) {
      copies.push({ major, version, source: 'Cargo.lock' });
    }
  }
  return copies;
}

/** `posthog-rs = "0.30"`, `posthog-rs = { version = "1", ... }` or a `[dependencies.posthog-rs]` table. */
function readCargoToml(content: string): InstalledSdk[] {
  const copies: InstalledSdk[] = [];
  const inline = new RegExp(
    `^\\s*"?${CRATE}"?\\s*=\\s*(?:"([^"]+)"|\\{[^}]*version\\s*=\\s*"([^"]+)")`,
    'gm',
  );
  for (const match of content.matchAll(inline)) {
    const spec = match[1] ?? match[2];
    const major = lowerBoundMajor(spec);
    if (major !== undefined)
      copies.push({
        major,
        version: spec,
        source: 'Cargo.toml',
        ...(isUnboundedRequirement(spec) ? { unbounded: true } : {}),
      });
  }
  const table = new RegExp(
    `^\\[(?:[^\\]\\n]*\\.)?dependencies\\.${CRATE}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`,
    'gm',
  );
  for (const match of content.matchAll(table)) {
    const spec = /^version\s*=\s*"([^"]+)"/m.exec(match[1])?.[1];
    const major = spec === undefined ? undefined : lowerBoundMajor(spec);
    if (spec !== undefined && major !== undefined) {
      copies.push({
        major,
        version: spec,
        source: 'Cargo.toml',
        ...(isUnboundedRequirement(spec) ? { unbounded: true } : {}),
      });
    }
  }
  return copies;
}

export function readCargoInstalls(installDir: string): InstalledSdk[] {
  const lock = readProjectFile(
    path.join(installDir, 'Cargo.lock'),
    LOCKFILE_MAX_BYTES,
  );
  if (lock !== null) {
    const copies = dedupeInstalled(readCargoLock(lock));
    if (copies.length > 0) return copies;
  }
  const manifest = readProjectFile(path.join(installDir, 'Cargo.toml'));
  return manifest === null ? [] : dedupeInstalled(readCargoToml(manifest));
}
