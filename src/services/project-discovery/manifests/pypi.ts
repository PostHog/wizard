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

// Pragmatic, not a full TOML parser — only the dep shapes we care about.
export function parsePyprojectToml(content: string): string[] {
  const depNames: string[] = [];

  for (const arrayMatch of content.matchAll(
    /dependencies\s*=\s*\[([^\]]*)\]/g,
  )) {
    const arrayBody = arrayMatch[1];
    for (const quotedMatch of arrayBody.matchAll(/["']([^"']+)["']/g)) {
      const depSpec = quotedMatch[1];
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
