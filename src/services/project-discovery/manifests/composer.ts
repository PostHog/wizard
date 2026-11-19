/** `composer.json` `require` and `require-dev` keys, minus PHP itself and extensions. */
export function parseComposerJson(content: string): string[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch {
    return [];
  }
  if (typeof manifest !== 'object' || manifest === null) return [];
  const names: string[] = [];
  for (const section of ['require', 'require-dev']) {
    const deps = (manifest as Record<string, unknown>)[section];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const name of Object.keys(deps)) {
      if (name === 'php' || name.startsWith('ext-')) continue;
      names.push(name.toLowerCase());
    }
  }
  return names;
}
