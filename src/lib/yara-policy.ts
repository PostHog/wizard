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

/** Severities that end the session on their own, whatever the rule asks for. */
const TERMINAL_SEVERITIES = new Set(['critical']);

/** The match that ends the session rather than just warning. */
export function isTerminalMatch(match: ScanMatch): boolean {
  return (
    TERMINAL_SEVERITIES.has(match.metadata.severity ?? '') ||
    match.metadata.action === 'block'
  );
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
