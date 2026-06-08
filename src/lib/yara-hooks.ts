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
import fg from 'fast-glob';
import type { ScanMatch, TriageMatch, LLMProvider } from '@posthog/warlock';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';
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
//
// TODO(warlock-npm): @posthog/warlock is currently a GIT dependency on a PRIVATE
// repo, pinned in package.json to a commit SHA. A private git dep breaks
// `npx @posthog/wizard` for end users, so before any public wizard release —
// once warlock is published to npm — do all of:
//   1. package.json: swap "git+https://github.com/PostHog/warlock.git#<sha>"
//      for a published version range (e.g. "^1.0.0").
//   2. pnpm-workspace.yaml: remove "@posthog/warlock" from onlyBuiltDependencies
//      (no install-time build once it ships prebuilt dist/).
//   3. If the published version is <7 days old, add "@posthog/warlock" to a
//      minimumReleaseAgeExclude allowlist or the wizard's min-release-age policy
//      will block the install.

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
type ScanContext = 'command' | 'input' | 'output';

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

// ─── Hook Timeouts (ms) ─────────────────────────────────────────
// Generous because triage adds an LLM round-trip, and because a *fired* hook
// timeout means the protective action is dropped (fail-open). The triage HTTP
// call has its own shorter internal timeout (see agent-interface), so a hung
// triage fails inside our catch (fail-closed) before these fire.

/** Timeout for scan hooks (PreToolUse, PostToolUse Write/Edit/Read/Grep) */
const HOOK_TIMEOUT_MS = 30_000;
/** Timeout for the skill install hook (filesystem I/O + multiple scans) */
const SKILL_SCAN_HOOK_TIMEOUT_MS = 30_000;

/** Maximum content length to scan (100 KB). Inputs beyond this are truncated. */
const MAX_SCAN_LENGTH = 100_000;

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

function isWizardDocumentationPath(filePath: string | undefined): boolean {
  if (!filePath) return false;
  const basename = path.basename(filePath);
  if (WIZARD_DOC_BASENAMES.has(basename)) return true;
  return WIZARD_DOC_PATTERNS.some((re) => re.test(basename));
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
 */
async function triageFilter(
  content: string,
  matches: ScanMatch[],
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
    logToFile(
      `[YARA] triage: ${matches.length} flagged → ${kept.length} kept as real`,
    );
    return kept;
  } catch (err) {
    logToFile('[YARA] triage failed — treating all matches as real:', err);
    return matches;
  }
}

/** Scan content, filter to the relevant context, triage. Returns real matches. */
async function scanAndTriage(
  content: string,
  ctx: ScanContext,
  llmProvider: LLMProvider | undefined,
): Promise<ScanMatch[]> {
  const warlock = await getWarlock();
  const scanContent =
    content.length > MAX_SCAN_LENGTH
      ? content.slice(0, MAX_SCAN_LENGTH)
      : content;
  const result = await warlock.scan(scanContent);
  if (!result.matched) return [];
  const filtered = matchesForContext(result.matches, ctx);
  return triageFilter(scanContent, filtered, llmProvider);
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

            return {
              decision: 'block',
              reason: `[YARA] ${match.rule}: ${
                match.metadata.description ?? 'security policy violation'
              }. Command blocked for security.`,
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
            const matches = await scanAndTriage(content, 'output', llmProvider);
            if (matches.length === 0) return {};

            // Wizard-documentation paths: suppress posthog_pii matches that
            // come from the agent verbatim-copying the user's existing
            // capture calls into an inventory / report, or planning new
            // events with PII-shaped property keys. Every other category
            // still triggers the revert.
            // TODO(warlock-npm): once Joe's warlock PR #33 lands with its
            // more-precise PII rules, the wizard-side suppression below
            // should become unnecessary — remove `WIZARD_DOC_BASENAMES`,
            // `WIZARD_DOC_PATTERNS`, and `isWizardDocumentationPath` and
            // verify the noisy-PII issue stays fixed.
            const filePath = toolInput?.file_path as string | undefined;
            const activeMatches = isWizardDocumentationPath(filePath)
              ? matches.filter((m) => m.metadata.category !== 'posthog_pii')
              : matches;
            if (activeMatches.length === 0) {
              logToFile(
                `[YARA] posthog_pii match suppressed on wizard doc ${path.basename(
                  filePath ?? '',
                )} (rule: ${matches[0]?.rule})`,
              );
              return {};
            }

            const match = highestSeverityMatch(activeMatches);
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

  const warlock = await getWarlock();
  // Pass 1 (sequential): scan + filter per file. WASM scanning is
  // single-threaded so this loop has to be serial — collect (scanContent,
  // matches) tuples for every file that flagged something.
  // Triage per-file so each match is judged against the content it came from.
  // The previous "scan per file, triage one combined buffer" approach passed
  // triage a `combined.slice(0, MAX_SCAN_LENGTH)` window that often didn't
  // contain the matched evidence (matches in later files past the 100KB cut),
  // biasing the LLM toward `false_positive` on real attacks.
  const flagged: { scanContent: string; matches: ScanMatch[] }[] = [];
  for (const content of fileContents) {
    const scanContent =
      content.length > MAX_SCAN_LENGTH
        ? content.slice(0, MAX_SCAN_LENGTH)
        : content;
    const result = await warlock.scan(scanContent);
    if (!result.matched) continue;
    const matches = matchesForContext(result.matches, 'input');
    if (matches.length === 0) continue;
    flagged.push({ scanContent, matches });
  }

  // Pass 2 (parallel): triage each flagged file's matches against its own
  // content concurrently. Triage is just an axios call — running them in
  // parallel cuts total wall-clock from N × triage-timeout to ~1 ×.
  // Important because the hook's HOOK_TIMEOUT_MS is 30s; serial triage on
  // 2+ matched files could blow the hook timeout under a slow Haiku.
  const triagedPerFile = await Promise.all(
    flagged.map(({ scanContent, matches }) =>
      triageFilter(scanContent, matches, llmProvider),
    ),
  );
  return triagedPerFile.flat();
}
