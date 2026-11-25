/**
 * Module versions from `go.mod` `require` lines and blocks, by module path,
 * without `// indirect` requirements (a dependency of a dependency says little
 * about the project). A final `/vN` major-version element is dropped, so
 * `stripe-go/v82` matches the catalog's `stripe-go`. Case is kept: Go module
 * paths are case-sensitive.
 */
export function parseGoMod(content: string): Record<string, string> {
  const modules: Record<string, string> = {};
  let inBlock = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      if (line.startsWith(')')) {
        inBlock = false;
        continue;
      }
      addGoRequirement(line, modules);
    } else if (/^require\s*\(\s*(?:\/\/.*)?$/.test(line)) {
      inBlock = true;
    } else if (line.startsWith('require ')) {
      addGoRequirement(line.slice('require '.length).trim(), modules);
    }
  }
  return modules;
}

function addGoRequirement(line: string, modules: Record<string, string>): void {
  if (!line || line.startsWith('//') || /\/\/\s*indirect\b/.test(line)) return;
  const [modulePath, version = ''] = line.split(/\s+/);
  modules[modulePath.replace(/\/v\d+$/, '')] = version;
}
