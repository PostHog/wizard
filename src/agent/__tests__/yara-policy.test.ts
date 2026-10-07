import { describe, expect, test } from 'vitest';
import type { ScanMatch } from '@posthog/warlock';
import {
  isTerminalMatch,
  publishBlockingMatch,
  scanVerdict,
} from '../yara-policy';

function match(
  severity: string,
  action: string,
  rule = `rule_${severity}_${action}`,
): ScanMatch {
  return {
    rule,
    metadata: {
      description: `${severity} / ${action}`,
      severity,
      category: 'prompt_injection',
      action,
      scan_context: 'input',
    },
    matchedStrings: ['x'],
  } as ScanMatch;
}

describe('yara-policy: terminate-or-warn', () => {
  test('critical severity terminates whatever the rule asks for', () => {
    expect(isTerminalMatch(match('critical', 'remediate'))).toBe(true);
  });

  test('a rule asking to block does not terminate below critical', () => {
    // `action: 'block'` refuses the operation (PreToolUse still does); it does
    // not end the run. medium/high block rules fire on first-party skill prose
    // often enough that terminating cost ~15 users/day — see #997.
    expect(isTerminalMatch(match('low', 'block'))).toBe(false);
    expect(isTerminalMatch(match('medium', 'block'))).toBe(false);
    expect(isTerminalMatch(match('high', 'block'))).toBe(false);
    expect(isTerminalMatch(match('critical', 'block'))).toBe(true);
  });

  test('a high-severity rule that only asks to remediate warns', () => {
    expect(isTerminalMatch(match('high', 'remediate'))).toBe(false);
  });

  test('the medium-severity integration-attack heuristic warns, never aborts', () => {
    // The false positive that killed real runs: a commandment phrased as
    // "remove this error" tripped this rule and pi treated it as fatal.
    const heuristic = match(
      'medium',
      'unknown',
      'prompt_injection_posthog_integration_attack',
    );
    expect(isTerminalMatch(heuristic)).toBe(false);
    expect(scanVerdict([heuristic])).toMatchObject({
      terminal: false,
      action: 'warned',
    });
  });
});

describe('yara-policy: scanVerdict', () => {
  test('no matches is no verdict', () => {
    expect(scanVerdict([])).toBeNull();
  });

  test('reports the highest-severity match, not the first', () => {
    const verdict = scanVerdict([
      match('low', 'remediate'),
      match('high', 'remediate'),
    ]);
    expect(verdict?.match.metadata.severity).toBe('high');
  });

  test('a terminal match is recorded as aborted', () => {
    expect(scanVerdict([match('critical', 'block')])).toMatchObject({
      terminal: true,
      action: 'aborted',
    });
  });

  test('an unranked severity does not outrank a known one', () => {
    const verdict = scanVerdict([
      match('medium', 'remediate'),
      match('unknown', 'remediate'),
    ]);
    expect(verdict?.match.metadata.severity).toBe('medium');
  });
});

describe('yara-policy: publish gate', () => {
  test('nothing blocks a clean publish', () => {
    expect(publishBlockingMatch([])).toBeNull();
  });

  test('a high-severity remediate match does not refuse the publish', () => {
    expect(publishBlockingMatch([match('high', 'remediate')])).toBeNull();
    expect(publishBlockingMatch([match('medium', 'warn')])).toBeNull();
  });

  test('a rule asking to block still does not refuse below critical', () => {
    // Same disposition as isTerminalMatch: severity decides, not `action`.
    expect(publishBlockingMatch([match('high', 'block')])).toBeNull();
  });

  test('a critical match refuses the publish and is the one reported', () => {
    const critical = match('critical', 'remediate', 'hardcoded_github_pat');
    expect(publishBlockingMatch([match('high', 'remediate'), critical])).toBe(
      critical,
    );
  });
});
