/** Pod versions from a `Podfile`, by pod; a subspec (`Firebase/Analytics`) reports its pod. */
export function parsePodfile(content: string): Record<string, string> {
  return Object.fromEntries(
    [
      ...content.matchAll(
        /^[ \t]*pod[ \t]+['"]([^'"/\n]+)(?:\/[^'"\n]*)?['"](?:[ \t]*,[ \t]*['"]([^'"\n]+)['"])?/gm,
      ),
    ].map((m) => [m[1], m[2] ?? '']),
  );
}
