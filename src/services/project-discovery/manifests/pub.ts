/** Package names under the top-level `dependencies` and `dev_dependencies` of a `pubspec.yaml`. */
export function parsePubspecYaml(content: string): string[] {
  const names: string[] = [];
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
    const key = /^([A-Za-z0-9_]+)\s*:/.exec(raw.trim());
    if (key) names.push(key[1]);
  }
  return names;
}
