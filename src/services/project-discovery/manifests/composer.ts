/** `composer.json` `require` and `require-dev` constraints by package, minus PHP itself and extensions. */
export function parseComposerJson(content: string): Record<string, string> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch {
    return {};
  }
  if (typeof manifest !== 'object' || manifest === null) return {};
  const packages: Record<string, string> = {};
  for (const section of ['require', 'require-dev']) {
    const deps = (manifest as Record<string, unknown>)[section];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (name === 'php' || name.startsWith('ext-')) continue;
      packages[name.toLowerCase()] = typeof version === 'string' ? version : '';
    }
  }
  return packages;
}
