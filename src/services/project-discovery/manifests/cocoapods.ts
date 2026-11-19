/** Pod names from a `Podfile`; a subspec (`Firebase/Analytics`) reports its pod. */
export function parsePodfile(content: string): string[] {
  return [...content.matchAll(/^\s*pod\s+['"]([^'"/]+)/gm)].map((m) => m[1]);
}
