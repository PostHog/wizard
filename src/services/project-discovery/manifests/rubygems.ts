/** Gem versions from `gem 'name'` declarations, by gem. */
export function parseGemfile(content: string): Record<string, string> {
  return Object.fromEntries(
    [
      ...content.matchAll(
        /^\s*gem\s+['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?/gm,
      ),
    ].map((m) => [m[1], m[2] ?? '']),
  );
}
