const MAVEN_COORDINATE =
  /['"]([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::[^'"\s]*)?['"]/g;
const GRADLE_MAP_NOTATION =
  /group\s*[:=]\s*['"]([^'"]+)['"]\s*,\s*name\s*[:=]\s*['"]([^'"]+)['"]/g;

/** `group:artifact` coordinates from `build.gradle` or `build.gradle.kts`. */
export function parseGradleBuild(content: string): string[] {
  const names: string[] = [];
  for (const m of content.matchAll(MAVEN_COORDINATE)) {
    names.push(`${m[1]}:${m[2]}`);
  }
  for (const m of content.matchAll(GRADLE_MAP_NOTATION)) {
    names.push(`${m[1]}:${m[2]}`);
  }
  return names;
}

/** `group:artifact` coordinates from a Gradle version catalog (`libs.versions.toml`). */
export function parseGradleVersionCatalog(content: string): string[] {
  const names: string[] = [];
  for (const m of content.matchAll(/\bmodule\s*=\s*"([^":]+):([^":]+)"/g)) {
    names.push(`${m[1]}:${m[2]}`);
  }
  for (const m of content.matchAll(GRADLE_MAP_NOTATION)) {
    names.push(`${m[1]}:${m[2]}`);
  }
  // Plain string form: `sentry = "io.sentry:sentry:7.0.0"`.
  for (const m of content.matchAll(
    /^\s*[A-Za-z0-9_.-]+\s*=\s*"([^":\s]+):([^":\s]+):[^"]*"/gm,
  )) {
    names.push(`${m[1]}:${m[2]}`);
  }
  return names;
}

/**
 * `groupId:artifactId` for each `<dependency>` in a `pom.xml`. Split on the
 * opening tag rather than matched lazily, which would rescan the rest of the
 * file for every unclosed `<dependency>`.
 */
export function parsePomXml(content: string): string[] {
  const names: string[] = [];
  for (const piece of content.split('<dependency>').slice(1)) {
    const close = piece.indexOf('</dependency>');
    if (close === -1) continue;
    const block = piece.slice(0, close);
    const group = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(block);
    const artifact = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(block);
    if (group && artifact) names.push(`${group[1]}:${artifact[1]}`);
  }
  return names;
}
