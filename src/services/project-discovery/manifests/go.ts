/**
 * Module paths from `go.mod` `require` lines and blocks, without `// indirect`
 * requirements (a dependency of a dependency says little about the project).
 * A final `/vN` major-version element is dropped, so `stripe-go/v82` matches
 * the catalog's `stripe-go`. Case is kept: Go module paths are case-sensitive.
 */
export function parseGoMod(content: string): string[] {
  const names: string[] = [];
  let inBlock = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      if (line.startsWith(')')) {
        inBlock = false;
        continue;
      }
      addGoRequirement(line, names);
    } else if (/^require\s*\(\s*(?:\/\/.*)?$/.test(line)) {
      inBlock = true;
    } else if (line.startsWith('require ')) {
      addGoRequirement(line.slice('require '.length).trim(), names);
    }
  }
  return names;
}

function addGoRequirement(line: string, names: string[]): void {
  if (!line || line.startsWith('//') || /\/\/\s*indirect\b/.test(line)) return;
  const modulePath = line.split(/\s+/)[0];
  names.push(modulePath.replace(/\/v\d+$/, ''));
}
