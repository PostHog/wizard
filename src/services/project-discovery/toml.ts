/** TOML reading shared by the manifest and workspace marker parsers. Pragmatic: only the shapes they need. */

/** The strings of the TOML array that opens at `start`. A bracket inside a string, such as an extra, does not close the array. */
export function tomlArrayStrings(content: string, start: number): string[] {
  const strings: string[] = [];
  let i = start;
  while (i < content.length) {
    const ch = content[i];
    if (ch === ']') return strings;
    if (ch === '#') {
      const lineEnd = content.indexOf('\n', i);
      if (lineEnd === -1) break;
      i = lineEnd + 1;
    } else if (ch === '"' || ch === "'") {
      const end = closingQuote(content, i);
      if (end === -1) break;
      strings.push(content.slice(i + 1, end));
      i = end + 1;
    } else {
      i += 1;
    }
  }
  // An array that never closes is not read.
  return [];
}

/** The index of the quote that closes the string opened at `open`, or -1. Only a basic (`"`) string has escapes. */
function closingQuote(content: string, open: number): number {
  const quote = content[open];
  for (let i = open + 1; i < content.length; i += 1) {
    if (content[i] === '\\' && quote === '"') i += 1;
    else if (content[i] === quote) return i;
  }
  return -1;
}
