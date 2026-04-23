/**
 * Pure utility functions for keyboard hints — no React or Ink dependencies.
 * Extracted for testability in a node Jest environment.
 */

export interface KeyboardHint {
  label: string;
  action: string;
  priority: number;
}

/** Well-known key matches corresponding to Ink's key.* properties. */
export enum KeyMatch {
  UpArrow = 'upArrow',
  DownArrow = 'downArrow',
  LeftArrow = 'leftArrow',
  RightArrow = 'rightArrow',
  Return = 'return',
  Escape = 'escape',
  Space = 'space',
}

/** A key match: either a KeyMatch enum value or a literal character string (e.g. 'a', 's'). */
export type KeyMatchOrChar = KeyMatch | (string & NonNullable<unknown>);

/** Default priorities by key type. */
const DEFAULT_PRIORITY: Record<string, number> = {
  [KeyMatch.UpArrow]: 0,
  [KeyMatch.DownArrow]: 0,
  [KeyMatch.LeftArrow]: 1,
  [KeyMatch.RightArrow]: 1,
  [KeyMatch.Space]: 10,
  [KeyMatch.Escape]: 20,
  [KeyMatch.Return]: 21,
};

/** Get the default display priority for a key match. */
export function getDefaultPriority(
  match: KeyMatchOrChar | KeyMatchOrChar[],
): number {
  const first = Array.isArray(match) ? match[0] : match;
  return DEFAULT_PRIORITY[first] ?? 15;
}

/** Check if a KeyMatchOrChar matches the given input string and key flags. */
export function matchesKey(
  m: KeyMatchOrChar,
  input: string,
  key: { [k: string]: unknown },
): boolean {
  switch (m) {
    case KeyMatch.UpArrow:
      return !!key.upArrow;
    case KeyMatch.DownArrow:
      return !!key.downArrow;
    case KeyMatch.LeftArrow:
      return !!key.leftArrow;
    case KeyMatch.RightArrow:
      return !!key.rightArrow;
    case KeyMatch.Return:
      return !!key.return;
    case KeyMatch.Escape:
      return !!key.escape;
    case KeyMatch.Space:
      return input === ' ';
    default:
      return input === m;
  }
}

/** Serialize hints for comparison. */
export function hintsKey(hints: KeyboardHint[]): string {
  return hints.map((h) => `${h.label}:${h.action}`).join('|');
}

/** Deduplicate hints by label+action and sort by priority. */
export function deduplicateAndSort(hints: KeyboardHint[]): KeyboardHint[] {
  const seen = new Set<string>();
  const deduped: KeyboardHint[] = [];
  for (const hint of hints) {
    const k = `${hint.label}:${hint.action}`;
    if (!seen.has(k)) {
      seen.add(k);
      deduped.push(hint);
    }
  }
  deduped.sort((a, b) => a.priority - b.priority);
  return deduped;
}
