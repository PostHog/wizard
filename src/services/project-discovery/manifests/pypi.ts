// PyPI normalizes `_` to `-` and is case-insensitive.
function normalizePyName(name: string): string {
  return name.toLowerCase().replace(/_/g, '-');
}

export function parseRequirementsTxt(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
    .map((line) => line.replace(/\[[^\]]*\]/, ''))
    .map((line) => line.split(/[<>=!~;\s]/)[0])
    .filter(Boolean)
    .map(normalizePyName);
}

/** The strings of the TOML array that opens at `start`. A bracket inside a string, such as an extra, does not close the array. */
function tomlArrayStrings(content: string, start: number): string[] {
  const strings: string[] = [];
  let i = start;
  while (i < content.length) {
    const ch = content[i];
    if (ch === ']') return strings;
    if (ch === '#') {
      const lineEnd = content.indexOf('\n', i);
      if (lineEnd === -1) break;
      i = lineEnd + 1;
    } else if (ch === '"' || ch === "'") {
      const end = closingQuote(content, i);
      if (end === -1) break;
      strings.push(content.slice(i + 1, end));
      i = end + 1;
    } else {
      i += 1;
    }
  }
  // An array that never closes is not read.
  return [];
}

/** The index of the quote that closes the string opened at `open`, or -1. Only a basic (`"`) string has escapes. */
function closingQuote(content: string, open: number): number {
  const quote = content[open];
  for (let i = open + 1; i < content.length; i += 1) {
    if (content[i] === '\\' && quote === '"') i += 1;
    else if (content[i] === quote) return i;
  }
  return -1;
}

// Pragmatic, not a full TOML parser — only the dep shapes we care about.
export function parsePyprojectToml(content: string): string[] {
  const depNames: string[] = [];

  for (const header of content.matchAll(/dependencies\s*=\s*\[/g)) {
    const start = (header.index ?? 0) + header[0].length;
    for (const depSpec of tomlArrayStrings(content, start)) {
      const name = depSpec.replace(/\[[^\]]*\]/, '').split(/[<>=!~;\s]/)[0];
      if (name) depNames.push(normalizePyName(name));
    }
  }

  const poetrySectionRe =
    /\[tool\.poetry\.(?:dev-dependencies|dependencies|group\.[^.\]]+\.dependencies)\]([\s\S]*?)(?=\n\[|$)/g;
  for (const sectionMatch of content.matchAll(poetrySectionRe)) {
    const sectionBody = sectionMatch[1];
    depNames.push(...extractTomlSectionKeys(sectionBody, { skip: ['python'] }));
  }

  return depNames;
}

export function parsePipfile(content: string): string[] {
  const depNames: string[] = [];
  const sectionRe = /\[(packages|dev-packages)\]([\s\S]*?)(?=\n\[|$)/g;
  for (const sectionMatch of content.matchAll(sectionRe)) {
    const sectionBody = sectionMatch[2];
    depNames.push(...extractTomlSectionKeys(sectionBody));
  }
  return depNames;
}

function extractTomlSectionKeys(
  sectionBody: string,
  opts: { skip?: string[] } = {},
): string[] {
  const skipNames = new Set(opts.skip ?? []);
  const depNames: string[] = [];
  for (const line of sectionBody.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;
    const name = trimmed.slice(0, equalsIndex).trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) continue;
    if (skipNames.has(name.toLowerCase())) continue;
    depNames.push(normalizePyName(name));
  }
  return depNames;
}
