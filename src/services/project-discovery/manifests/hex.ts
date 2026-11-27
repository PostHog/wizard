/** Hex package versions from `mix.exs` dependency tuples, e.g. `{:sentry, "~> 10.0"}`. */
export function parseMixExs(content: string): Record<string, string> {
  return Object.fromEntries(
    [...content.matchAll(/\{\s*:([a-z][a-z0-9_]*)\s*,\s*(?:"([^"]*)")?/g)].map(
      (m) => [m[1], m[2] ?? ''],
    ),
  );
}
