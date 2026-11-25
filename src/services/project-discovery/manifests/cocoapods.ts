/** Pod versions from a `Podfile`, by pod; a subspec (`Firebase/Analytics`) reports its pod. */
export function parsePodfile(content: string): Record<string, string> {
  return Object.fromEntries(
    [
      ...content.matchAll(
        /^\s*pod\s+['"]([^'"/]+)[^'"]*['"](?:\s*,\s*['"]([^'"]+)['"])?/gm,
      ),
    ].map((m) => [m[1], m[2] ?? '']),
  );
}
