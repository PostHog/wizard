import { tomlArrayStrings } from '../toml';

// PyPI normalizes `_` to `-` and is case-insensitive.
function normalizePyName(name: string): string {
  return name.toLowerCase().replace(/_/g, '-');
}

/** A PEP 508 requirement as name and specifier: `posthog[sentry]>=7.40,<8; python_version>"3"` is `posthog`, `>=7.40,<8`. */
function requirement(spec: string): Array<[string, string]> {
  const bare = spec
    .replace(/\[[^\]]*\]/, '')
    .split(';')[0]
    .trim();
  const name = bare.split(/[<>=!~\s]/)[0];
  return name ? [[normalizePyName(name), bare.slice(name.length).trim()]] : [];
}

export function parseRequirementsTxt(content: string): Record<string, string> {
  return Object.fromEntries(
    content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('-'))
      .flatMap(requirement),
  );
}

// Pragmatic, not a full TOML parser — only the dep shapes we care about.
export function parsePyprojectToml(content: string): Record<string, string> {
  const deps: Array<[string, string]> = [];

  for (const header of content.matchAll(/dependencies\s*=\s*\[/g)) {
    const start = (header.index ?? 0) + header[0].length;
    for (const depSpec of tomlArrayStrings(content, start)) {
      deps.push(...requirement(depSpec));
    }
  }

  const poetrySectionRe =
    /\[tool\.poetry\.(?:dev-dependencies|dependencies|group\.[^.\]]+\.dependencies)\]([\s\S]*?)(?=\n\[|$)/g;
  for (const sectionMatch of content.matchAll(poetrySectionRe)) {
    const sectionBody = sectionMatch[1];
    deps.push(...extractTomlSectionKeys(sectionBody, { skip: ['python'] }));
  }

  return Object.fromEntries(deps);
}

export function parsePipfile(content: string): Record<string, string> {
  const deps: Array<[string, string]> = [];
  const sectionRe = /\[(packages|dev-packages)\]([\s\S]*?)(?=\n\[|$)/g;
  for (const sectionMatch of content.matchAll(sectionRe)) {
    const sectionBody = sectionMatch[2];
    deps.push(...extractTomlSectionKeys(sectionBody));
  }
  return Object.fromEntries(deps);
}

/** `name = "^1.2"` and `name = { version = "^1.2" }` entries as name and version. */
function extractTomlSectionKeys(
  sectionBody: string,
  opts: { skip?: string[] } = {},
): Array<[string, string]> {
  const skipNames = new Set(opts.skip ?? []);
  const deps: Array<[string, string]> = [];
  for (const line of sectionBody.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) continue;
    const name = trimmed.slice(0, equalsIndex).trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) continue;
    if (skipNames.has(name.toLowerCase())) continue;
    const value = trimmed.slice(equalsIndex + 1);
    const version =
      /^\s*["']([^"']*)["']/.exec(value)?.[1] ??
      /\bversion\s*=\s*["']([^"']*)["']/.exec(value)?.[1] ??
      '';
    deps.push([normalizePyName(name), version]);
  }
  return deps;
}
