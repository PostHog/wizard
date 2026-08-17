/**
 * Shared YARA scan policy: the vocabulary every scan surface speaks, and the
 * one decision they all make — does a set of matches terminate the session, or
 * only warn. Both fences (the anthropic PostToolUse hooks in `yara-hooks.ts`
 * and the pi tool_result extension in `harness/pi/security.ts`) resolve a
 * verdict here rather than each re-deriving it from severity and action.
 */

import type { ScanMatch } from '@posthog/warlock';

/** Which content surface a warlock rule applies to (from rule `scan_context`). */
export type ScanContext = 'command' | 'input' | 'output';

/** What a fence did about a match, as recorded in the scan report. */
export type ScanAction = 'blocked' | 'reverted' | 'warned' | 'aborted';

/** Severity order, highest first, for picking the match worth reporting. */
const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Severities that end the session. Critical only — nothing below it is worth killing a run over. */
const TERMINAL_SEVERITIES = new Set(['critical']);

/**
 * The match that ends the session rather than just warning. Severity alone
 * decides: a rule's `action: 'block'` is a recommendation about the *operation*
 * (PreToolUse still refuses the command), not a licence to end the run. Medium
 * and high `block` rules fire on first-party content often enough that
 * terminating on them costs more than it prevents.
 */
export function isTerminalMatch(match: ScanMatch): boolean {
  return TERMINAL_SEVERITIES.has(match.metadata.severity ?? '');
}

/** Return the highest-severity match from a list of matches. */
export function highestSeverityMatch(matches: ScanMatch[]): ScanMatch {
  return matches.reduce((worst, m) =>
    (SEVERITY_RANK[m.metadata.severity ?? ''] ?? 0) >
    (SEVERITY_RANK[worst.metadata.severity ?? ''] ?? 0)
      ? m
      : worst,
  );
}

export interface ScanVerdict {
  /** The match worth reporting: the highest-severity one. */
  match: ScanMatch;
  /** Session ends now; anything else is advisory. */
  terminal: boolean;
  /** How the scan report records it. */
  action: ScanAction;
}

/** Resolve what a fence should do about a set of matches. Null when clean. */
export function scanVerdict(matches: ScanMatch[]): ScanVerdict | null {
  if (matches.length === 0) return null;
  const match = highestSeverityMatch(matches);
  const terminal = isTerminalMatch(match);
  return { match, terminal, action: terminal ? 'aborted' : 'warned' };
}
