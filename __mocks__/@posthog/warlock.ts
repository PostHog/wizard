// Mock for @posthog/warlock
//
// The real package is ESM-only and loads a YARA-X WASM binary at runtime, which
// jest cannot transform/execute. Unit tests exercise the wizard's own decision
// logic (scan_context filtering, severity/action mapping, triage handling,
// fail-closed behavior) against these jest.fn()s — never the real engine. Rule
// matching itself is tested in the warlock repo.

export type Category =
  | 'prompt_injection'
  | 'exfiltration'
  | 'destructive_operations'
  | 'supply_chain'
  | 'posthog_pii'
  | 'posthog_hardcoded_key'
  | 'hardcoded_secret';

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Action = 'warn' | 'block' | 'remediate';

export interface RuleMetadata {
  description?: string;
  severity?: Severity;
  category?: Category;
  action?: Action;
  [key: string]: string | number | boolean | undefined;
}

export interface ScanMatch {
  rule: string;
  metadata: RuleMetadata;
}

export type ScanResult =
  | { matched: false }
  | { matched: true; matches: ScanMatch[] };

export type TriageVerdict = 'true_positive' | 'false_positive';

export interface TriageMatch extends ScanMatch {
  triage: { verdict: TriageVerdict; reason: string };
}

export type LLMProvider = (prompt: string) => Promise<string>;

export const CATEGORIES = [
  'prompt_injection',
  'exfiltration',
  'destructive_operations',
  'supply_chain',
  'posthog_pii',
  'posthog_hardcoded_key',
  'hardcoded_secret',
] as const;

// Default: nothing matches. Tests override per-case with mockResolvedValueOnce.
export const scan = jest.fn(
  (_content: string): Promise<ScanResult> =>
    Promise.resolve({ matched: false }),
);

// Default: pass matches through as true positives (mirrors warlock's fail-safe).
export const triageMatches = jest.fn(
  (
    _content: string,
    matches: ScanMatch[],
    _provider: LLMProvider,
  ): Promise<TriageMatch[]> =>
    Promise.resolve(
      matches.map((m) => ({
        ...m,
        triage: { verdict: 'true_positive' as const, reason: 'mock triage' },
      })),
    ),
);
