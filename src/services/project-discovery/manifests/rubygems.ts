/** Extract gem names from `gem 'name'` declarations. */
export function parseGemfile(content: string): string[] {
  const gems: string[] = [];
  for (const match of content.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)) {
    gems.push(match[1]);
  }
  return gems;
}
