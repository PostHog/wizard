// Mock for @posthog/warlock
//
// The real package is ESM-only and loads a YARA-X WASM binary at runtime, which
// the unit test runner can't execute. Unit tests exercise the wizard's own decision
// logic (scan_context filtering, severity/action mapping, triage handling,
// fail-closed behavior) against these vi.fn()s — never the real engine. Rule
// matching itself is tested in the warlock repo.

import type * as RealWarlock from '@posthog/warlock';

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
  /** Evidence spans lifted from the scanned content (added in warlock 0.2.x). */
  matchedStrings: string[];
}

export type ScanResult =
  | { matched: false }
  | { matched: true; matches: ScanMatch[] };

export type TriageVerdict = 'true_positive' | 'false_positive';

export interface TriageMatch extends ScanMatch {
  triage: { verdict: TriageVerdict; reason: string };
}

export interface TriageOptions {
  maxPromptChars?: number;
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
export const scan = vi.fn(
  (_content: string): Promise<ScanResult> =>
    Promise.resolve({ matched: false }),
);

// Default: pass matches through as true positives (mirrors warlock's fail-safe).
export const triageMatches = vi.fn(
  (
    _content: string,
    matches: ScanMatch[],
    _provider: LLMProvider,
    _options?: TriageOptions,
  ): Promise<TriageMatch[]> =>
    Promise.resolve(
      matches.map((m) => ({
        ...m,
        triage: { verdict: 'true_positive' as const, reason: 'mock triage' },
      })),
    ),
);

// ─── Compile-time drift guard ────────────────────────────────────
// If the real package's exports change shape, this assignment stops
// type-checking and `pnpm test` fails — so the mock can't silently diverge
// from the engine the wizard actually ships with. It works because vitest's
// resolve.alias is runtime-only: the `import type` above resolves to the
// REAL package under TypeScript and is fully erased at runtime.
// (This guard caught warlock 0.2.2 adding the required `matchedStrings`
// field to ScanMatch.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _conformance: Pick<
  typeof RealWarlock,
  'scan' | 'triageMatches' | 'CATEGORIES'
> = { scan, triageMatches, CATEGORIES };
