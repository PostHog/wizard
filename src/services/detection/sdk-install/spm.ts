import * as path from 'path';
import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import type { InstalledSdk } from '@shared/sdk-capture-mode';
import { dedupeInstalled } from './types';
import { lowerBoundMajor, majorOfVersion } from './version-spec';

const REPO = /posthog\/posthog-ios/i;
/** CocoaPods never gets a 4.x pod, so a bare `pod 'PostHog'` is a 3.x install. */
const LAST_COCOAPODS_MAJOR = 3;

type ResolvedPin = {
  identity?: string;
  package?: string;
  location?: string;
  repositoryURL?: string;
  state?: { version?: string | null };
};

/** Version 1 nests the pins under `object`; versions 2 and 3 list them at the top. */
function readPackageResolved(content: string, source: string): InstalledSdk[] {
  const parsed = JSON.parse(content) as {
    pins?: ResolvedPin[];
    object?: { pins?: ResolvedPin[] };
  };
  const pins = parsed.pins ?? parsed.object?.pins ?? [];
  const copies: InstalledSdk[] = [];
  for (const pin of pins) {
    const name = pin.identity ?? pin.package ?? '';
    const url = pin.location ?? pin.repositoryURL ?? '';
    if (name.toLowerCase() !== 'posthog-ios' && !REPO.test(url)) continue;
    const version = pin.state?.version;
    const major = version ? majorOfVersion(version) : undefined;
    if (version && major !== undefined) copies.push({ major, version, source });
  }
  return copies;
}

/**
 * The Xcode project's package reference:
 * `repositoryURL = "https://github.com/PostHog/posthog-ios"; requirement = { kind = upToNextMajorVersion; minimumVersion = 3.0.0; };`
 */
function readPbxproj(content: string, source: string): InstalledSdk[] {
  const copies: InstalledSdk[] = [];
  const reference = /XCRemoteSwiftPackageReference[^{]*\{([\s\S]*?)\n\s*\};/g;
  for (const match of content.matchAll(reference)) {
    const block = match[1];
    if (!REPO.test(block)) continue;
    const version = /(?:minimumVersion|version)\s*=\s*"?([\d.]+)"?/.exec(
      block,
    )?.[1];
    const major = version
      ? majorOfVersion(version) ?? lowerBoundMajor(version)
      : undefined;
    if (version && major !== undefined) copies.push({ major, version, source });
  }
  return copies;
}

/**
 * XcodeGen: the package's own mapping block (the lines indented deeper than
 * its key) carries `url` and `from`, `exactVersion`, `majorVersion`,
 * `minVersion` or `version`; a neighbouring package's keys never count.
 */
function readXcodeGen(content: string): InstalledSdk[] {
  const copies: InstalledSdk[] = [];
  const lines = content.split('\n');
  const indentOf = (line: string) => line.length - line.trimStart().length;
  for (let u = 0; u < lines.length; u += 1) {
    if (!/url:\s*\S*posthog\/posthog-ios/i.test(lines[u])) continue;
    // The package key is the nearest line above with a smaller indent.
    const urlIndent = indentOf(lines[u]);
    let k = u - 1;
    while (
      k >= 0 &&
      (lines[k].trim() === '' || indentOf(lines[k]) >= urlIndent)
    ) {
      k -= 1;
    }
    if (k < 0) continue;
    const keyIndent = indentOf(lines[k]);
    for (let j = k + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '') continue;
      if (indentOf(line) <= keyIndent) break;
      const match =
        /^\s*(from|exactVersion|majorVersion|minVersion|version):\s*"?([^"\s]+)"?/.exec(
          line,
        );
      if (!match) continue;
      const major = lowerBoundMajor(match[2]);
      if (major !== undefined) {
        copies.push({
          major,
          version: `${match[1]}: ${match[2]}`,
          source: 'project.yml',
        });
        break;
      }
    }
  }
  return copies;
}

function readPodfileLock(content: string): InstalledSdk[] {
  const version = /^\s*-\s*PostHog\s*\(([^)]+)\)/m.exec(content)?.[1];
  const major = version ? majorOfVersion(version) : undefined;
  return version && major !== undefined
    ? [{ major, version, source: 'Podfile.lock' }]
    : [];
}

function readPodfile(content: string): InstalledSdk[] {
  const match = /^\s*pod\s+['"]PostHog['"]\s*(?:,\s*['"]([^'"]+)['"])?/m.exec(
    content,
  );
  if (!match) return [];
  const spec = match[1];
  const major = spec
    ? lowerBoundMajor(spec) ?? LAST_COCOAPODS_MAJOR
    : LAST_COCOAPODS_MAJOR;
  return [{ major, version: spec ?? 'pod PostHog', source: 'Podfile' }];
}

const RESOLVED_GLOBS = [
  'Package.resolved',
  '*.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
  '*.xcworkspace/xcshareddata/swiftpm/Package.resolved',
];

export async function readSpmInstalls(
  installDir: string,
): Promise<InstalledSdk[]> {
  const copies: InstalledSdk[] = [];
  const resolved = await boundedGlob(RESOLVED_GLOBS, {
    cwd: installDir,
    limit: 10,
  });
  for (const file of resolved.sort()) {
    const content = readProjectFile(path.join(installDir, file));
    if (content === null) continue;
    try {
      copies.push(...readPackageResolved(content, file));
    } catch {
      // A malformed pin file falls through to the project files.
    }
  }
  if (copies.length === 0) {
    const projects = await boundedGlob('*.xcodeproj/project.pbxproj', {
      cwd: installDir,
      limit: 10,
    });
    for (const file of projects.sort()) {
      const content = readProjectFile(path.join(installDir, file));
      if (content !== null) copies.push(...readPbxproj(content, file));
    }
    const xcodegen = readProjectFile(path.join(installDir, 'project.yml'));
    if (xcodegen !== null) copies.push(...readXcodeGen(xcodegen));
  }
  const podfileLock = readProjectFile(path.join(installDir, 'Podfile.lock'));
  if (podfileLock !== null) copies.push(...readPodfileLock(podfileLock));
  if (podfileLock === null) {
    const podfile = readProjectFile(path.join(installDir, 'Podfile'));
    if (podfile !== null) copies.push(...readPodfile(podfile));
  }
  return dedupeInstalled(copies);
}
