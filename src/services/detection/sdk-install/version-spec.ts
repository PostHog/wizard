/**
 * The lowest major a dependency requirement admits, across the ecosystems'
 * spellings: `^5.60.0`, `>=7,<8`, `==7.*`, `~=7.1`, `0.30`, `3.+`, `[3.0,4.0)`,
 * `>=3.0.0 <6.0.0`, `from: 3.0.0`. Upper bounds and exclusions are ignored. A
 * requirement with no lower bound (`*`, `any`, `latest`, empty) has no major.
 */
const UNBOUNDED = new Set(['', '*', 'x', 'any', 'latest']);

export function lowerBoundMajor(spec: string): number | undefined {
  // A Maven range with no lower bound, `(,4.0]`, admits every major.
  if (/^[[(]\s*,/.test(spec.trim())) return undefined;
  let majors: number[] = [];
  const cleaned = spec
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^[[(]|[\])]$/g, '')
    .trim();
  const tokens = cleaned
    .split(/\s*(?:,|\|\||\s)\s*/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  for (const token of tokens) {
    if (token.startsWith('<') || token.startsWith('!=')) continue;
    const bare = token
      .replace(
        /^(?:from|minVersion|version|exactVersion|majorVersion):?\s*/i,
        '',
      )
      .replace(/^(?:>=|~=|==|\^|~|>|=)/, '')
      .replace(/^v/, '')
      .trim();
    if (UNBOUNDED.has(bare.toLowerCase())) continue;
    const match = /^(\d+)(?:[.+x*]|$)/.exec(bare);
    if (!match) continue;
    majors = [...majors, Number(match[1])];
  }
  return majors.length === 0 ? undefined : Math.min(...majors);
}

/** The major of a concrete version such as `7.82.1`, `v2.0.0` or `0.30.0`. */
export function majorOfVersion(version: string): number | undefined {
  const match = /^v?(\d+)\./.exec(version.trim().replace(/^["']|["']$/g, ''));
  return match ? Number(match[1]) : undefined;
}

/**
 * Whether a requirement has no upper bound: every token is `>=` or `>` (or a
 * Maven range open on the right), so the major it installs is whatever the
 * registry serves next. A caret, tilde, exact or `<` constraint bounds it.
 */
export function isUnboundedRequirement(spec: string): boolean {
  const cleaned = spec.trim().replace(/^["']|["']$/g, '');
  if (/^[[(][^,]*,\s*[)\]]$/.test(cleaned)) return true;
  const tokens = cleaned
    .split(/\s*(?:,|\|\||\s)\s*/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return tokens.length > 0 && tokens.every((token) => /^>=?\d/.test(token));
}

/**
 * The lowest `major.minor` a requirement admits (`>=3.9`, `^3.41.0`, `1.75`,
 * `3.38.0-stable`), ignoring upper bounds. Undefined when nothing is bounded.
 */
export function lowerBoundVersion(
  spec: string,
): { major: number; minor: number } | undefined {
  let best: { major: number; minor: number } | undefined;
  const cleaned = spec.trim().replace(/^["']|["']$/g, '');
  for (const raw of cleaned.split(/\s*(?:,|\|\||\s)\s*/)) {
    const token = raw.trim();
    if (!token || token.startsWith('<') || token.startsWith('!=')) continue;
    const bare = token.replace(/^(?:>=|~=|==|\^|~|>|=)/, '').replace(/^v/, '');
    const match = /^(\d+)\.(\d+)/.exec(bare);
    if (!match) continue;
    const candidate = { major: Number(match[1]), minor: Number(match[2]) };
    if (!best || compareVersions(candidate, best) < 0) best = candidate;
  }
  return best;
}

export function compareVersions(
  a: { major: number; minor: number },
  b: { major: number; minor: number },
): number {
  return a.major !== b.major ? a.major - b.major : a.minor - b.minor;
}
