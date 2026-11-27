const MAVEN_COORDINATE =
  /['"]([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::([^'"\s]*))?['"]/g;
const GRADLE_MAP_NOTATION =
  /group\s*[:=]\s*['"]([^'"]+)['"]\s*,\s*name\s*[:=]\s*['"]([^'"]+)['"]/g;

/** Versions by `group:artifact` coordinate from `build.gradle` or `build.gradle.kts`. */
export function parseGradleBuild(content: string): Record<string, string> {
  const coordinates: Record<string, string> = {};
  for (const m of content.matchAll(MAVEN_COORDINATE)) {
    coordinates[`${m[1]}:${m[2]}`] = m[3] ?? '';
  }
  for (const m of content.matchAll(GRADLE_MAP_NOTATION)) {
    coordinates[`${m[1]}:${m[2]}`] ??= '';
  }
  return coordinates;
}

/** Versions by `group:artifact` coordinate from a Gradle version catalog (`libs.versions.toml`); a `version.ref` reads as none. */
export function parseGradleVersionCatalog(
  content: string,
): Record<string, string> {
  const coordinates: Record<string, string> = {};
  for (const m of content.matchAll(/\bmodule\s*=\s*"([^":]+):([^":]+)"/g)) {
    coordinates[`${m[1]}:${m[2]}`] = '';
  }
  for (const m of content.matchAll(GRADLE_MAP_NOTATION)) {
    coordinates[`${m[1]}:${m[2]}`] = '';
  }
  // Plain string form: `sentry = "io.sentry:sentry:7.0.0"`.
  for (const m of content.matchAll(
    /^\s*[A-Za-z0-9_.-]+\s*=\s*"([^":\s]+):([^":\s]+):([^"]*)"/gm,
  )) {
    coordinates[`${m[1]}:${m[2]}`] = m[3];
  }
  return coordinates;
}

/**
 * Versions by `groupId:artifactId` for each `<dependency>` in a `pom.xml`. Split on the
 * opening tag rather than matched lazily, which would rescan the rest of the
 * file for every unclosed `<dependency>`.
 */
export function parsePomXml(content: string): Record<string, string> {
  const coordinates: Record<string, string> = {};
  for (const piece of content.split('<dependency>').slice(1)) {
    const close = piece.indexOf('</dependency>');
    if (close === -1) continue;
    const block = piece.slice(0, close);
    const group = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(block);
    const artifact = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(block);
    const version = /<version>\s*([^<\s]+)\s*<\/version>/.exec(block);
    if (group && artifact) {
      coordinates[`${group[1]}:${artifact[1]}`] = version?.[1] ?? '';
    }
  }
  return coordinates;
}
