/**
 * YARA hook wiring for the Claude Agent SDK.
 *
 * Creates PreToolUse and PostToolUse hook callback arrays that integrate the
 * real @posthog/warlock security scanner (YARA-X via WASM) into the wizard's
 * agent loop. These hooks are registered in the SDK's query() options alongside
 * the existing Stop hook.
 *
 * PreToolUse hooks block dangerous commands before execution. PostToolUse hooks
 * detect violations in written code and prompt injection in read content, and
 * scan context-mill skill downloads.
 *
 * Warlock owns the rules; this file owns the *policy* — how a match maps to a
 * block / revert / terminate response, plus the optional LLM triage pass that
 * filters false positives before we act.
 *
 * Naming: "yara" is the technique — scanning content against YARA rules — so the
 * wizard-side wiring keeps that name. "warlock" is the engine package that runs
 * the rules. Both names showing up here is intentional.
 *
 * This is Layer 2 (L2) in the wizard's defense-in-depth model, complementing the
 * prompt-based commandments (L0) and the canUseTool() allowlist (L1).
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import fg from 'fast-glob';
import type {
  ScanMatch,
  TriageMatch,
  LLMProvider,
  Category,
} from '@posthog/warlock';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
import { getUI } from '@ui';
import type { WizardSession } from '@lib/wizard-session';
import { isSkillInstallCommand } from './skill-install';
import { WIZARD_YARA_REPORT_FILE } from '@utils/paths';
// TODO(wizard#594): invert this dependency.
// L2 infra (yara-hooks) imports product-specific filename constants from
// individual programs. The leaf `constants.ts` modules break the *import*
// cycle but don't fix the *layering* concern: this file knowing about
// `events-audit`, `posthog-integration`, and `audit` violates "product
// knowledge never enters infrastructure code." Proper fix is inverted —
// programs declare their own doc paths, the hooks read from a generic
// registry. For now: every new program emitting a PII-shaped report has
// to be added here. Land that cleanup before adding a fourth entry.
import {
  SETUP_REPORT_FILE as EVENTS_AUDIT_REPORT_FILE,
  EVENT_INVENTORY_FILE,
  EVENT_INVENTORY_PART_PATTERN,
} from '@lib/programs/events-audit/constants';
import { AUDIT_REPORT_FILE } from '@lib/programs/audit/types';
import { EVENT_PLAN_FILE } from '@lib/programs/posthog-integration/constants';

// ─── Warlock module accessor ─────────────────────────────────────
// Warlock is ESM-only and lazily inits its WASM engine + compiles rules on the
// first scan() call. We import it once and cache the module promise so the
// warmed engine (a warlock-internal singleton) is shared across every hook.
// Mirrors the lazy `await import(...)` pattern used for the agent SDK.

type WarlockModule = typeof import('@posthog/warlock');

let warlockModulePromise: Promise<WarlockModule> | null = null;

function getWarlock(): Promise<WarlockModule> {
  if (!warlockModulePromise) {
    // Clear the cache on rejection so a transient failure (flaky disk, ESM
    // resolver hiccup) doesn't poison the cache for the rest of the process
    // lifetime. Without this, one rejected import permanently locks every
    // hook into fail-closed-terminate until restart.
    warlockModulePromise = import('@posthog/warlock').catch((err) => {
      warlockModulePromise = null;
      throw err;
    });
  }
  return warlockModulePromise;
}

/**
 * Pay the WASM-init + rule-compile cost up front, off the hook path, so the
 * first real tool-call scan doesn't eat cold-start under a hook timeout.
 * Best-effort: a failure here is non-fatal — hooks still fail closed per scan.
 */
export async function prewarmYaraScanner(): Promise<void> {
  try {
    const warlock = await getWarlock();
    await warlock.scan('');
    logToFile('[YARA] warlock pre-warmed');
  } catch (err) {
    logToFile('[YARA] warlock pre-warm failed:', err);
  }
}

// ─── Types ───────────────────────────────────────────────────────
// Loose hook types to avoid tight coupling to the SDK version.
// The SDK hook types are: HookCallbackMatcher[], where each matcher
// has { matcher?: string, hooks: HookCallback[], timeout?: number }

type HookInput = Record<string, unknown>;
type HookOutput = Record<string, unknown>;
type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookOutput>;

export interface HookCallbackMatcher {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number;
}

/** Which content surface a warlock rule applies to (from rule `scan_context`). */
export type ScanContext = 'command' | 'input' | 'output';

// ─── Scan Report Accumulator ─────────────────────────────────────

type ScanAction = 'blocked' | 'reverted' | 'warned' | 'aborted';

interface ScanReportEntry {
  rule: string;
  severity: string;
  category: string;
  action: ScanAction;
  phase: string;
  tool: string;
  /** Rule description — the human-readable "why". Rule-static, safe to report. */
  description: string;
  /** Triage outcome, when triage ran. */
  triageVerdict?: string;
  /**
   * Free-text triage rationale. May quote scanned content, so it is written to
   * the local report file only — NEVER sent to PostHog (see captureScanReport).
   */
  triageReason?: string;
}

let scanCount = 0;
const scanViolations: ScanReportEntry[] = [];

function recordScan(): void {
  scanCount++;
}

// recordMatch is the single entry point for a violation (log + telemetry +
// report). scanViolations is appended only there.

/**
 * Log a match to the run log + PostHog, and record it in the run's scan report.
 * Single entry point so every violation is reported consistently.
 */
function recordMatch(
  phase: string,
  tool: string,
  match: ScanMatch,
  action: ScanAction,
): void {
  const triage = (match as TriageMatch).triage;
  logYaraMatch(phase, tool, match, action);
  scanViolations.push({
    rule: match.rule,
    severity: match.metadata.severity ?? 'unknown',
    category: match.metadata.category ?? 'unknown',
    action,
    phase,
    tool,
    description: match.metadata.description ?? '',
    triageVerdict: triage?.verdict,
    triageReason: triage?.reason,
  });
}

/** Reset counters (for testing) */
export function resetScanReport(): void {
  scanCount = 0;
  scanViolations.length = 0;
}

/** Format the scan report summary. Returns null if no scans occurred */
export function formatScanReport(): string | null {
  if (scanCount === 0) return null;

  const lines: string[] = ['', '— YARA Scanner Summary —'];
  const violationCount = scanViolations.length;
  const cleanCount = scanCount - violationCount;

  lines.push(
    `✓ ${scanCount} tool calls scanned, ${violationCount} violation${
      violationCount !== 1 ? 's' : ''
    } detected`,
  );

  if (violationCount > 0) {
    lines.push('');
    for (const v of scanViolations) {
      const tag = v.action.toUpperCase();
      lines.push(
        `  [${tag}] ${v.rule} (${v.severity.toUpperCase()}) — ${v.phase}:${
          v.tool
        }`,
      );
    }
  }

  if (cleanCount > 0) {
    lines.push('');
    lines.push(
      `No violations: ✓ ${cleanCount} clean scan${cleanCount !== 1 ? 's' : ''}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

/** Write the scan report to a JSON file. Returns the file path, or null if no scans occurred. */
export function writeScanReport(): string | null {
  if (scanCount === 0) return null;

  const report = {
    summary: {
      totalScans: scanCount,
      violations: scanViolations.length,
      clean: scanCount - scanViolations.length,
    },
    violations: scanViolations,
  };

  try {
    fs.writeFileSync(WIZARD_YARA_REPORT_FILE, JSON.stringify(report, null, 2));
  } catch (err) {
    logToFile('[YARA] Failed to write scan report:', err);
    return null;
  }
  return WIZARD_YARA_REPORT_FILE;
}

// ─── User-facing abort copy ──────────────────────────────────────
//
// The abort screen is the one security surface a user actually sees, so it must
// say what was caught and that we protected them, in plain language, instead of
// a bare "Security violation detected." Warlock owns the rules and categories;
// this map is the wizard's *presentation* of a category it already detected. We
// deliberately do not surface warlock's own rule `description` here: it is
// written for maintainers (it ships to telemetry) and reads as technical. The
// `Category` type is a stable, append-only warlock API, so a new category just
// falls through to the generic line below rather than breaking the build.

const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  prompt_injection:
    'hit hidden instructions in a file it read, a possible attempt to hijack the setup',
  exfiltration: 'tried to send data to an outside location',
  destructive_operations: 'tried to run a destructive command',
  supply_chain: 'tried to pull in untrusted code',
  posthog_pii: 'tried to write personal data (PII) into your project',
  posthog_hardcoded_key: 'tried to hardcode a PostHog key into your project',
  hardcoded_secret: 'tried to hardcode a secret into your project',
};

/** Most recent violation that terminated the run, or null. */
function lastTerminatingViolation(): ScanReportEntry | null {
  for (let i = scanViolations.length - 1; i >= 0; i--) {
    if (scanViolations[i].action === 'aborted') return scanViolations[i];
  }
  return null;
}

/**
 * Build the user-facing copy for the security abort screen: what the scanner
 * caught and what we did about it. This screen renders only because the run was
 * stopped, so the "what we did" half is constant. Falls back to a generic line
 * when no specific violation was recorded (e.g. the scanner itself errored and
 * failed closed before a match was logged).
 */
export function formatYaraAbortMessage(): string {
  const v = lastTerminatingViolation();
  const what =
    (v && CATEGORY_DESCRIPTIONS[v.category as Category]) ??
    'did something our security scanner flagged';

  return (
    'Security check stopped the setup.\n\n' +
    `The agent ${what}. We stopped the run to keep your project safe.\n` +
    'No unsafe changes were left in your project.\n\n' +
    'If this looks wrong, let us know: wizard@posthog.com'
  );
}

// ─── Hook Timeouts (ms) ─────────────────────────────────────────
// Generous because triage adds an LLM round-trip, and because a *fired* hook
// timeout means the protective action is dropped (fail-open). The triage HTTP
// call has its own shorter internal timeout (see agent-interface), so a hung
// triage fails inside our catch (fail-closed) before these fire.

/** Timeout for scan hooks (PreToolUse, PostToolUse Write/Edit/Read/Grep) */
const HOOK_TIMEOUT_MS = 30_000;
/** Timeout for the skill install hook (filesystem I/O + multiple scans) */
const SKILL_SCAN_HOOK_TIMEOUT_MS = 30_000;

/**
 * Chunk size for scanning (100 KB). Oversized content is scanned in
 * overlapping chunks so coverage is complete — nothing is silently truncated.
 * The size also bounds what a single triage call pastes into the LLM prompt
 * (~25K tokens), so triage always sees the chunk its matches came from.
 */
const SCAN_CHUNK_SIZE = 100_000;
/**
 * Overlap between adjacent chunks so a pattern straddling a chunk boundary
 * still lands whole inside at least one chunk. YARA rule strings are at most
 * a few hundred bytes; 4 KB is generous.
 */
const SCAN_CHUNK_OVERLAP = 4_096;

// ─── Logging ─────────────────────────────────────────────────────

function logYaraMatch(
  phase: string,
  tool: string,
  match: ScanMatch,
  action: ScanAction,
): void {
  const severity = match.metadata.severity ?? 'unknown';
  const category = match.metadata.category ?? 'unknown';
  const ruleAction = match.metadata.action ?? 'unknown';
  const description = match.metadata.description ?? '';
  logToFile(
    `[YARA] ${phase}:${tool} [${action.toUpperCase()}] rule "${match.rule}" ` +
      `(severity: ${severity}, category: ${category}, action: ${ruleAction})\n` +
      `  Description: ${description}`,
  );
  analytics.wizardCapture('yara rule matched', {
    rule: match.rule,
    severity: match.metadata.severity,
    category: match.metadata.category,
    rule_action: match.metadata.action,
    action,
    phase,
    tool,
    // Rule-static description — the "why". The free-text triage reason is
    // deliberately omitted (it can quote scanned content; stays local-only).
    description: match.metadata.description,
    triage_verdict: (match as TriageMatch).triage?.verdict,
  });
}

/**
 * Send the run's full scan report to PostHog so maintainers can see why a run
 * was flagged, warned, or aborted. This is the maintainer-facing report — it is
 * NEVER shown to the user. No-op if nothing was scanned. The free-text triage
 * reason is omitted to avoid sending scanned content off the user's machine.
 */
export function captureScanReport(): void {
  if (scanCount === 0) return;
  analytics.wizardCapture('yara scan report', {
    total_scans: scanCount,
    violation_count: scanViolations.length,
    clean_count: scanCount - scanViolations.length,
    violations: scanViolations.map((v) => ({
      rule: v.rule,
      severity: v.severity,
      category: v.category,
      action: v.action,
      phase: v.phase,
      tool: v.tool,
      description: v.description,
      triage_verdict: v.triageVerdict,
    })),
  });
  // Reset after sending so a second captureScanReport on this same run
  // (e.g. success-path call followed by an abort during shutdown) can't
  // ship duplicate telemetry. Also protects future chained-program runs.
  scanCount = 0;
  scanViolations.length = 0;
}

/**
 * End-of-run flush for the scan report. Wired once at the runner seam so every
 * harness (linear, orchestrator, and any future shape) reports without having
 * to know warlock exists — scanning is already harness-agnostic (it runs from
 * SDK Pre/PostToolUse hooks), and this keeps reporting at a single shared seam.
 *
 * Order matters: write the local --yara-report file FIRST (it reads scanCount /
 * scanViolations), THEN send telemetry. captureScanReport() zeroes scan state,
 * which is what makes this whole function idempotent — a second call from
 * another termination path (e.g. finally after an abort already flushed) finds
 * scanCount === 0 and every step no-ops.
 */
export function flushScanReport(
  session: Pick<WizardSession, 'yaraReport'>,
): void {
  if (session.yaraReport) {
    const reportPath = writeScanReport();
    if (reportPath) {
      const summary = formatScanReport();
      getUI().log.info(`YARA scan report: ${reportPath}${summary ?? ''}`);
    }
  }
  captureScanReport();
}

// ─── Wizard-documentation allowlist ───────────────────────────────
//
// Files the wizard's own programs write to describe events the user's
// codebase already captures, or events the integration program is
// proposing to add. When the agent copies a literal
// `posthog.capture('event', { email: ... })` snippet (or a property
// list including PII-shaped keys) into one of these files, the
// `pii_in_capture_call` rule (category: posthog_pii) fires even though
// the wizard is documenting / planning, not introducing, the pattern.
// Suppress posthog_pii matches on these paths only; every other rule
// (secrets, prompt injection, supply chain, destructive ops) still
// fires normally so the file cannot be used as a smuggling vector for
// actual violations.

const WIZARD_DOC_BASENAMES = new Set([
  EVENT_INVENTORY_FILE,
  EVENTS_AUDIT_REPORT_FILE,
  AUDIT_REPORT_FILE,
  EVENT_PLAN_FILE,
]);

const WIZARD_DOC_PATTERNS: RegExp[] = [EVENT_INVENTORY_PART_PATTERN];

export function isWizardDocumentationPath(
  filePath: string | undefined,
): boolean {
  if (!filePath) return false;
  const basename = path.basename(filePath);
  if (WIZARD_DOC_BASENAMES.has(basename)) return true;
  return WIZARD_DOC_PATTERNS.some((re) => re.test(basename));
}

// ─── Repeat-block tracker ─────────────────────────────────────────
//
// Field data (switchboard YARA tile): an agent whose edit gets blocked often
// retries the identical payload — the scan is deterministic, so every retry
// blocks again and the run burns turns (~4.2 blocks per affected run). The
// runtime notes already say "don't retry"; the data shows the prompt alone
// doesn't hold. This is the code-side guard: remember the exact payloads we
// blocked, and when the same content comes back, escalate the block reason —
// first to "change the code, not the retry", then to "report it and move on".
// Used by both fences: the anthropic PreToolUse Bash hook below, and the pi
// security extension's pre-execution scan (bash/write/edit).

/** Identical-payload attempt at which the agent is told to move on. */
const REPEAT_BLOCK_MOVE_ON_ATTEMPT = 3;

export interface RepeatBlockTracker {
  /**
   * Record a YARA block of `content` on `tool`; returns the attempt count
   * for that exact payload (1 = first time blocked).
   */
  attempt(tool: string, content: string): number;
}

/** Per-run tracker of YARA-blocked payloads (keyed by tool + content hash). */
export function createRepeatBlockTracker(): RepeatBlockTracker {
  const counts = new Map<string, number>();
  return {
    attempt(tool: string, content: string): number {
      const key = `${tool} ${createHash('sha256')
        .update(content)
        .digest('hex')}`;
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
  };
}

/**
 * The block reason for the given attempt: the plain reason the first time,
 * an explicit "this exact retry can never work" on the second, and a
 * "report it and move on" instruction from the third on.
 */
export function repeatBlockReason(
  attempt: number,
  tool: string,
  baseReason: string,
): string {
  if (attempt <= 1) return baseReason;
  if (attempt < REPEAT_BLOCK_MOVE_ON_ATTEMPT) {
    return (
      `${baseReason} This exact ${tool} content was ALREADY blocked — the scan is ` +
      'deterministic, so retrying identical content will always block again. ' +
      'Change the code to remove the flagged pattern instead of retrying.'
    );
  }
  return (
    `${baseReason} This exact ${tool} content has now been blocked ${attempt} times. ` +
    'STOP retrying it. Note the blocked change in the setup report and move on to the next task.'
  );
}

// ─── Severity helpers ────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Return the highest-severity match from a list of matches. */
function highestSeverityMatch(matches: ScanMatch[]): ScanMatch {
  return matches.reduce((worst, m) =>
    (SEVERITY_RANK[m.metadata.severity ?? ''] ?? 0) >
    (SEVERITY_RANK[worst.metadata.severity ?? ''] ?? 0)
      ? m
      : worst,
  );
}

// ─── Scan + triage core ──────────────────────────────────────────

/**
 * Keep only matches whose rule targets this content surface. Rules carry a
 * `scan_context` of 'command' | 'input' | 'output'. An undefined context is
 * treated as "applies everywhere" (fail-safe — a rule that forgets the tag
 * still gets enforced rather than silently skipped).
 */
function matchesForContext(
  matches: ScanMatch[],
  ctx: ScanContext,
): ScanMatch[] {
  return matches.filter((m) => {
    const c = m.metadata.scan_context as string | undefined;
    return c === ctx || c === undefined;
  });
}

/**
 * Drop false positives via warlock's LLM triage. Fail-closed: if no provider is
 * available, or the triage call throws, every match is treated as real — we
 * never silently suppress a flagged match.
 *
 * Every overruled match is reported to PostHog (rule metadata only, never the
 * free-text reason) so maintainers can alert on triage-overrule patterns — the
 * signal that someone is either tripping a noisy rule or trying to talk the
 * triage model out of a real finding.
 */
async function triageFilter(
  content: string,
  matches: ScanMatch[],
  ctx: ScanContext,
  llmProvider: LLMProvider | undefined,
): Promise<ScanMatch[]> {
  if (matches.length === 0) return [];
  if (!llmProvider) {
    logToFile(
      `[YARA] triage skipped (no provider) — treating ${matches.length} match(es) as real`,
    );
    return matches;
  }
  try {
    const warlock = await getWarlock();
    const triaged = await warlock.triageMatches(content, matches, llmProvider);
    const kept = triaged.filter((m) => m.triage.verdict === 'true_positive');
    for (const m of triaged) {
      if (m.triage.verdict === 'true_positive') continue;
      logToFile(
        `[YARA] triage overruled rule "${m.rule}" (${
          m.metadata.severity ?? 'unknown'
        }) — not acting on it`,
      );
      analytics.wizardCapture('yara triage overruled', {
        rule: m.rule,
        severity: m.metadata.severity,
        category: m.metadata.category,
        scan_context: ctx,
        // The free-text triage reason is deliberately omitted — it can quote
        // scanned content, which must never leave the user's machine.
      });
    }
    logToFile(
      `[YARA] triage: ${matches.length} flagged → ${kept.length} kept as real`,
    );
    return kept;
  } catch (err) {
    logToFile('[YARA] triage failed — treating all matches as real:', err);
    return matches;
  }
}

/** A chunk of scanned content together with the matches found inside it. */
interface FlaggedChunk {
  chunk: string;
  matches: ScanMatch[];
}

/**
 * Split oversized content into overlapping chunks so the scanner covers all
 * of it. Content that fits in one chunk is returned as-is.
 */
function chunkContent(content: string): string[] {
  if (content.length <= SCAN_CHUNK_SIZE) return [content];
  const chunks: string[] = [];
  const step = SCAN_CHUNK_SIZE - SCAN_CHUNK_OVERLAP;
  for (let start = 0; start < content.length; start += step) {
    chunks.push(content.slice(start, start + SCAN_CHUNK_SIZE));
    if (start + SCAN_CHUNK_SIZE >= content.length) break;
  }
  return chunks;
}

/**
 * Scan content against warlock rules — chunked when oversized, so nothing is
 * skipped — and keep only matches for this content surface. Chunks scan
 * sequentially (the WASM engine is single-threaded; parallelism buys nothing).
 * Returns each flagged chunk with its matches so triage can later judge every
 * match against the exact content it came from.
 */
async function scanForContext(
  content: string,
  ctx: ScanContext,
): Promise<FlaggedChunk[]> {
  const warlock = await getWarlock();
  const chunks = chunkContent(content);
  if (chunks.length > 1) {
    logToFile(
      `[YARA] content is ${content.length} chars — scanning ${chunks.length} overlapping chunks`,
    );
    // Alertable signal: oversized content should be rare; a spike could mean
    // someone is padding content to probe the scanner.
    analytics.wizardCapture('yara scan chunked', {
      content_length: content.length,
      chunk_count: chunks.length,
      scan_context: ctx,
    });
  }
  const flagged: FlaggedChunk[] = [];
  for (const chunk of chunks) {
    const result = await warlock.scan(chunk);
    if (!result.matched) continue;
    const matches = matchesForContext(result.matches, ctx);
    if (matches.length === 0) continue;
    flagged.push({ chunk, matches });
  }
  return flagged;
}

/** The overlap between chunks can surface the same rule twice; count it once. */
function dedupeByRule(matches: ScanMatch[]): ScanMatch[] {
  const seen = new Set<string>();
  return matches.filter((m) => {
    if (seen.has(m.rule)) return false;
    seen.add(m.rule);
    return true;
  });
}

/**
 * Triage each flagged chunk against its own content — the evidence is always
 * inside the window the LLM sees. Triage calls run in parallel (each is just
 * an HTTP round trip) so N flagged chunks cost ~1× triage latency, not N×.
 */
async function triageFlagged(
  flagged: FlaggedChunk[],
  ctx: ScanContext,
  llmProvider: LLMProvider | undefined,
): Promise<ScanMatch[]> {
  const triaged = await Promise.all(
    flagged.map(({ chunk, matches }) =>
      triageFilter(chunk, matches, ctx, llmProvider),
    ),
  );
  return dedupeByRule(triaged.flat());
}

/**
 * Scan content, filter to the relevant context, triage. Returns real matches.
 * Exported for harnesses that run their own hook loop (pi) so every harness
 * scans through the same warlock engine, chunking, and triage policy.
 */
export async function scanAndTriage(
  content: string,
  ctx: ScanContext,
  llmProvider: LLMProvider | undefined,
): Promise<ScanMatch[]> {
  const flagged = await scanForContext(content, ctx);
  return triageFlagged(flagged, ctx, llmProvider);
}

// ─── PreToolUse Hooks ────────────────────────────────────────────

/**
 * Create PreToolUse hook matchers for YARA scanning.
 * Scans Bash commands before execution for exfiltration, destructive
 * operations, and supply chain violations ('command'-context rules).
 */
export function createPreToolUseYaraHooks(
  // Accepted for API symmetry with createPostToolUseYaraHooks, but
  // intentionally unused: PreToolUse Bash always blocks on any flagged
  // command regardless of triage verdict, so the LLM call would be wasted.
  // Future PreToolUse hooks that need triage can wire this through.
  _llmProvider?: LLMProvider,
): HookCallbackMatcher[] {
  const repeatTracker = createRepeatBlockTracker();
  return [
    {
      hooks: [
        async (input: HookInput): Promise<HookOutput> => {
          try {
            const toolName = input.tool_name as string;
            if (toolName !== 'Bash') return {};

            const toolInput = input.tool_input as Record<string, unknown>;
            const command =
              typeof toolInput?.command === 'string' ? toolInput.command : '';

            if (!command) return {};

            recordScan();
            // Skip triage on PreToolUse Bash: any flagged command is blocked
            // regardless of triage verdict, so the LLM call would be wasted.
            const matches = await scanAndTriage(command, 'command', undefined);
            if (matches.length === 0) return {};

            const match = highestSeverityMatch(matches);
            recordMatch('PreToolUse', 'Bash', match, 'blocked');

            const attempt = repeatTracker.attempt('Bash', command);
            return {
              decision: 'block',
              reason: repeatBlockReason(
                attempt,
                'Bash',
                `[YARA] ${match.rule}: ${
                  match.metadata.description ?? 'security policy violation'
                }. Command blocked for security.`,
              ),
            };
          } catch (error) {
            logToFile('[YARA] PreToolUse hook error:', error);
            // Fail closed: block the command if scanning fails
            return {
              decision: 'block',
              reason: '[YARA] Scanner error — command blocked as a precaution.',
            };
          }
        },
      ],
      timeout: HOOK_TIMEOUT_MS,
    },
  ];
}

// ─── PostToolUse Hooks ───────────────────────────────────────────

/**
 * Create PostToolUse hook matchers for YARA scanning.
 *
 * Three matchers:
 * 1. Write/Edit — scan written content ('output'-context rules: PII, secrets)
 * 2. Read/Grep — scan read content ('input'-context rules: prompt injection)
 * 3. Bash (skill install) — scan downloaded skill files for poisoned content
 *
 * `onTerminate` is invoked on the terminal paths (critical prompt injection in
 * read content, a poisoned skill, or a scanner error under fail-closed). It is
 * what ACTUALLY stops the run — returning `stopReason` from a PostToolUse hook
 * is not honored by the SDK, so the caller wires this to the run's
 * AbortController (see agent-interface).
 */
export function createPostToolUseYaraHooks(
  llmProvider: LLMProvider | undefined,
  // REQUIRED, not optional: the SDK ignores `stopReason` from PostToolUse
  // hooks, so terminal paths (critical prompt injection, poisoned skill,
  // fail-closed scanner error) depend entirely on this callback firing.
  // Making it required at compile time prevents a future caller from
  // silently regressing every terminal path to a no-op.
  onTerminate: (reason: string) => void,
): HookCallbackMatcher[] {
  return [
    // ── Write/Edit content scanning ──
    {
      hooks: [
        async (input: HookInput): Promise<HookOutput> => {
          try {
            const toolName = input.tool_name as string;
            if (toolName !== 'Write' && toolName !== 'Edit') return {};

            const toolInput = input.tool_input as Record<string, unknown>;
            // For Write, scan the content being written.
            // For Edit, scan the new_string (replacement text).
            const content =
              toolName === 'Write'
                ? (toolInput?.content as string) ?? ''
                : (toolInput?.new_string as string) ?? '';

            if (!content) return {};

            recordScan();
            const flagged = await scanForContext(content, 'output');
            if (flagged.length === 0) return {};

            // Wizard-documentation paths: suppress posthog_pii matches that
            // come from the agent verbatim-copying the user's existing
            // capture calls into an inventory / report, or planning new
            // events with PII-shaped property keys. Every other category
            // still triggers the revert. Suppression runs BEFORE triage so
            // we never pay an LLM round trip for a match we're about to
            // discard anyway.
            // TODO(warlock#33): once warlock PR #33 lands with its
            // more-precise PII rules, the wizard-side suppression below
            // should become unnecessary — remove `WIZARD_DOC_BASENAMES`,
            // `WIZARD_DOC_PATTERNS`, and `isWizardDocumentationPath` and
            // verify the noisy-PII issue stays fixed.
            const filePath = toolInput?.file_path as string | undefined;
            const activeFlagged = isWizardDocumentationPath(filePath)
              ? flagged
                  .map(({ chunk, matches }) => ({
                    chunk,
                    matches: matches.filter(
                      (m) => m.metadata.category !== 'posthog_pii',
                    ),
                  }))
                  .filter(({ matches }) => matches.length > 0)
              : flagged;
            if (activeFlagged.length === 0) {
              logToFile(
                `[YARA] posthog_pii match suppressed on wizard doc ${path.basename(
                  filePath ?? '',
                )} (rule: ${flagged[0]?.matches[0]?.rule})`,
              );
              return {};
            }

            const matches = await triageFlagged(
              activeFlagged,
              'output',
              llmProvider,
            );
            if (matches.length === 0) return {};

            const match = highestSeverityMatch(matches);
            recordMatch('PostToolUse', toolName, match, 'reverted');

            return {
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext:
                  `[YARA VIOLATION] ${match.rule}: ${
                    match.metadata.description ?? ''
                  }. ` +
                  `You MUST revert this change immediately. The content you just wrote violates security policy.`,
              },
            };
          } catch (error) {
            logToFile('[YARA] PostToolUse Write/Edit hook error:', error);
            // Fail closed: if scanning is broken on a Write/Edit, the next
            // Read/skill-install scan is also going to be broken — terminate
            // cleanly instead of looping the agent through "please revert"
            // until a Read finally aborts. Matches Read/Grep + skill-install
            // catch behavior; consistent fail-closed across all PostToolUse.
            const reason =
              '[YARA] Scanner error while scanning written content — session terminated as a precaution.';
            onTerminate(reason);
            return { stopReason: reason };
          }
        },
      ],
      timeout: HOOK_TIMEOUT_MS,
    },

    // ── Read/Grep prompt injection scanning ──
    {
      hooks: [
        async (input: HookInput): Promise<HookOutput> => {
          try {
            const toolName = input.tool_name as string;
            if (toolName !== 'Read' && toolName !== 'Grep') return {};

            const toolResponse = input.tool_response;
            // Guard before stringify: `JSON.stringify(undefined ?? '')`
            // returns the 2-char string '""', which is truthy and slips
            // past the empty-content check below. Exit early when the SDK
            // gave us no response payload.
            if (toolResponse == null) return {};
            const content =
              typeof toolResponse === 'string'
                ? toolResponse
                : JSON.stringify(toolResponse);

            if (!content) return {};

            recordScan();
            const matches = await scanAndTriage(content, 'input', llmProvider);
            if (matches.length === 0) return {};

            const match = highestSeverityMatch(matches);

            // Critical severity or a rule asking us to block => terminate; the
            // agent's context may be poisoned by injected instructions.
            const isTerminal =
              match.metadata.severity === 'critical' ||
              match.metadata.action === 'block';

            if (isTerminal) {
              recordMatch('PostToolUse', toolName, match, 'aborted');
              const reason =
                `[YARA CRITICAL] ${match.rule}: Prompt injection detected in file content. ` +
                `Agent context is potentially poisoned. Session terminated for safety.`;
              onTerminate(reason);
              return { stopReason: reason };
            }

            recordMatch('PostToolUse', toolName, match, 'warned');
            return {
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext: `[YARA WARNING] ${match.rule}: ${
                  match.metadata.description ?? ''
                }`,
              },
            };
          } catch (error) {
            logToFile('[YARA] PostToolUse Read/Grep hook error:', error);
            // Fail closed: terminate session if scanning fails on read content
            const reason =
              '[YARA] Scanner error while scanning read content — session terminated as a precaution.';
            onTerminate(reason);
            return { stopReason: reason };
          }
        },
      ],
      timeout: HOOK_TIMEOUT_MS,
    },

    // ── Context-mill skill install scanning ──
    {
      hooks: [
        async (input: HookInput): Promise<HookOutput> => {
          try {
            const toolName = input.tool_name as string;
            if (toolName !== 'Bash') return {};

            const toolInput = input.tool_input as Record<string, unknown>;
            const command =
              typeof toolInput?.command === 'string' ? toolInput.command : '';

            // Only scan after skill install commands
            if (!isSkillInstallCommand(command)) return {};

            // Extract skill directory from command
            const dirMatch = command.match(
              /mkdir -p (.claude\/skills\/[^\s&]+)/,
            );
            if (!dirMatch) return {};

            const skillDir = dirMatch[1];
            const cwd = (input.cwd as string) ?? process.cwd();
            recordScan();
            const matches = await scanSkillFiles(cwd, skillDir, llmProvider);

            if (matches.length === 0) return {};

            // INTENTIONAL ASYMMETRY: skill-install terminates on ANY
            // post-triage match, while Read/Grep only terminates on
            // critical-or-block. Skills are downloaded code from an
            // external source; any flagged content in them is treated as
            // poisoned. Read/Grep, by contrast, may scan project files
            // the user wrote themselves where a medium-severity match
            // can warrant a warning instead of a terminate.
            // TODO(wizard#593): document / lock in this contract with a test.
            const match = highestSeverityMatch(matches);
            recordMatch(
              'PostToolUse',
              'Bash (skill install)',
              match,
              'aborted',
            );

            const reason =
              `[YARA CRITICAL] Poisoned skill detected in ${skillDir}: ${match.rule}. ` +
              `The downloaded skill contains potential prompt injection. Session terminated for safety.`;
            onTerminate(reason);
            return { stopReason: reason };
          } catch (error) {
            logToFile('[YARA] PostToolUse skill install hook error:', error);
            // Fail closed: terminate if skill scanning fails
            const reason =
              '[YARA] Scanner error while scanning skill files — session terminated as a precaution.';
            onTerminate(reason);
            return { stopReason: reason };
          }
        },
      ],
      timeout: SKILL_SCAN_HOOK_TIMEOUT_MS,
    },
  ];
}

// ─── Skill File Scanner ──────────────────────────────────────────

/**
 * Read and scan all text files in a skill directory for prompt injection.
 * Scans each file sequentially (single-threaded WASM — parallelism buys
 * nothing), unions the 'input'-context matches, then triages once across the
 * combined content. Returns the real (post-triage) matches.
 */
async function scanSkillFiles(
  cwd: string,
  skillDir: string,
  llmProvider: LLMProvider | undefined,
): Promise<ScanMatch[]> {
  const absoluteDir = path.resolve(cwd, skillDir);

  if (!fs.existsSync(absoluteDir)) {
    logToFile(`[YARA] Skill directory does not exist: ${absoluteDir}`);
    return [];
  }

  const files = await fg('**/*.{md,txt,yaml,yml,json,js,ts,py,rb,sh}', {
    cwd: absoluteDir,
    absolute: true,
  });

  const fileContents: string[] = [];
  for (const filePath of files) {
    try {
      fileContents.push(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      logToFile(`[YARA] Could not read skill file ${filePath}:`, err);
    }
  }

  if (fileContents.length === 0) {
    logToFile(`[YARA] No text files found in skill directory: ${absoluteDir}`);
    return [];
  }

  logToFile(
    `[YARA] Scanning ${fileContents.length} files in skill directory: ${skillDir}`,
  );

  // Pass 1 (sequential): scan each file through the chunk-aware path —
  // full coverage even for oversized files, and every flagged chunk keeps a
  // reference to the exact content its matches came from.
  const flagged: FlaggedChunk[] = [];
  for (const content of fileContents) {
    flagged.push(...(await scanForContext(content, 'input')));
  }

  // Pass 2 (parallel, inside triageFlagged): triage each flagged chunk
  // against its own content concurrently. Triage is just an axios call —
  // running them in parallel cuts total wall-clock from N × triage-timeout
  // to ~1×. Important because the hook's HOOK_TIMEOUT_MS is 30s; serial
  // triage on 2+ matched files could blow the hook timeout under a slow
  // Haiku.
  return triageFlagged(flagged, 'input', llmProvider);
}
