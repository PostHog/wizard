/** The heading of the warning block a handoff report opens with when work is left. */
export const NEEDS_ATTENTION_HEADING = 'Needs your attention';

const BLOCK_START = new RegExp(`^\\s*>\\s*⚠.*${NEEDS_ATTENTION_HEADING}`);

/** The bullets of a report's `> ⚠️ **Needs your attention**` block, or none. */
export function readNeedsAttention(markdown: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => BLOCK_START.test(line));
  if (start === -1) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (!quoted) break;
    const bullet = /^\s*(?:[-*]|\d+\.)\s+(.*\S)/.exec(quoted[1]);
    if (bullet) items.push(bullet[1]);
  }
  return items;
}
