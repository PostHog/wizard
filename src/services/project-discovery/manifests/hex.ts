/** Hex package names from `mix.exs` dependency tuples, e.g. `{:sentry, "~> 10.0"}`. */
export function parseMixExs(content: string): string[] {
  return [...content.matchAll(/\{\s*:([a-z][a-z0-9_]*)\s*,/g)].map((m) => m[1]);
}
