import * as path from 'path';
import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import type { InstalledSdk } from '@shared/sdk-capture-mode';
import { dedupeInstalled } from './types';
import { lowerBoundMajor } from './version-spec';

const GROUP = 'com.posthog';
const ARTIFACT = 'posthog-android';

/**
 * The version catalog: a `[libraries]` entry naming the module, with its
 * `version` inline or a `version.ref` into `[versions]`.
 */
function readVersionCatalog(content: string): InstalledSdk[] {
  const versions = new Map<string, string>();
  const versionsTable =
    /^\[versions\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(content)?.[1] ?? '';
  for (const match of versionsTable.matchAll(
    /^\s*([\w.-]+)\s*=\s*"([^"]+)"/gm,
  )) {
    versions.set(match[1], match[2]);
  }
  const copies: InstalledSdk[] = [];
  const librariesTable =
    /^\[libraries\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(content)?.[1] ?? '';
  for (const line of librariesTable.split('\n')) {
    const namesModule =
      line.includes(`"${GROUP}:${ARTIFACT}"`) ||
      (line.includes(`group = "${GROUP}"`) &&
        line.includes(`name = "${ARTIFACT}"`));
    if (!namesModule) continue;
    const inline = /version\s*=\s*"([^"]+)"/.exec(line)?.[1];
    const ref = /version\.ref\s*=\s*"([^"]+)"/.exec(line)?.[1];
    const spec = inline ?? (ref ? versions.get(ref) : undefined);
    const major = spec === undefined ? undefined : lowerBoundMajor(spec);
    if (spec !== undefined && major !== undefined) {
      copies.push({
        major,
        version: spec,
        source: 'gradle/libs.versions.toml',
      });
    }
  }
  return copies;
}

/** `implementation("com.posthog:posthog-android:3.75.0")`, `3.+` or a Maven range. */
function readGradleScript(content: string, source: string): InstalledSdk[] {
  const copies: InstalledSdk[] = [];
  const coordinate = new RegExp(`${GROUP}:${ARTIFACT}:([^"')\\s]+)`, 'g');
  for (const match of content.matchAll(coordinate)) {
    const major = lowerBoundMajor(match[1]);
    if (major !== undefined) copies.push({ major, version: match[1], source });
  }
  return copies;
}

export async function readMavenInstalls(
  installDir: string,
): Promise<InstalledSdk[]> {
  const copies: InstalledSdk[] = [];
  const catalog = readProjectFile(
    path.join(installDir, 'gradle', 'libs.versions.toml'),
  );
  if (catalog !== null) copies.push(...readVersionCatalog(catalog));
  const scripts = await boundedGlob(
    [
      'build.gradle',
      'build.gradle.kts',
      '*/build.gradle',
      '*/build.gradle.kts',
    ],
    {
      cwd: installDir,
      limit: 20,
    },
  );
  for (const file of scripts.sort()) {
    const content = readProjectFile(path.join(installDir, file));
    if (content !== null) copies.push(...readGradleScript(content, file));
  }
  return dedupeInstalled(copies);
}
