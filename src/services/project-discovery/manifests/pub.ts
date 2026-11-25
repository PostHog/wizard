/** Package constraints under the top-level `dependencies` and `dev_dependencies` of a `pubspec.yaml`, by name. */
export function parsePubspecYaml(content: string): Record<string, string> {
  const packages: Record<string, string> = {};
  let inDeps = false;
  let entryIndent: number | null = null;
  for (const raw of content.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) {
      inDeps = /^(dev_)?dependencies:\s*(?:#.*)?$/.test(raw.trim());
      entryIndent = null;
      continue;
    }
    if (!inDeps) continue;
    entryIndent ??= indent;
    if (indent !== entryIndent) continue;
    const entry = /^([A-Za-z0-9_]+)\s*:\s*['"]?([^'"#\s]*)/.exec(raw.trim());
    if (entry) packages[entry[1]] = entry[2];
  }
  return packages;
}
