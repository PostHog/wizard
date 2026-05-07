/**
 * Security hook wiring for the Claude Agent SDK.
 *
 * Uses @posthog/warlock for YARA-based content scanning and LLM triage.
 * Hooks are registered in the SDK's query() options.
 *
 * PreToolUse hooks block dangerous commands before execution.
 * PostToolUse hooks detect violations in written code, prompt
 * injection in read content, and scan skill downloads.
 */

import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import { scan, triageMatches } from '@posthog/warlock';
import type { ScanMatch, TriageMatch } from '@posthog/warlock';
import { logToFile } from '../utils/debug';
import { analytics } from '../utils/analytics';
import { isSkillInstallCommand } from './skill-install';

// ─── Types ───────────────────────────────────────────────────────

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

// ─── LLM triage ────────────────────────────────────────

function createTriageProvider(): ((prompt: string) => Promise<string>) | null {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!baseUrl || !apiKey) return null;

  return async (prompt: string): Promise<string> => {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 16384,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = (await res.json()) as {
      content: Array<{ text: string }>;
    };
    return data.content[0].text;
  };
}

let _triageProvider: ((prompt: string) => Promise<string>) | null | undefined;

function getTriageProvider(): ((prompt: string) => Promise<string>) | null {
  if (_triageProvider === undefined) {
    _triageProvider = createTriageProvider();
  }
  return _triageProvider;
}

// ─── Scan + triage helper ───────────────────────────────────────

async function scanAndTriage(
  content: string,
  scanContext: string,
): Promise<TriageMatch[]> {
  const result = await scan(content);
  if (!result.matched) {
    logToFile(`[WARLOCK] scan (${scanContext}): clean`);
    return [];
  }

  const relevant = result.matches.filter(
    (m) => m.metadata.scan_context === scanContext,
  );
  if (relevant.length === 0) {
    logToFile(
      `[WARLOCK] scan (${scanContext}): ${result.matches.length} match(es) but none for this context`,
    );
    return [];
  }

  const rules = relevant.map((m) => m.rule).join(', ');
  logToFile(
    `[WARLOCK] scan (${scanContext}): ${relevant.length} match(es) — ${rules}`,
  );

  const provider = getTriageProvider();
  if (!provider) {
    logToFile(`[WARLOCK] triage skipped — no LLM provider available`);
    return relevant.map((m) => ({
      ...m,
      triage: {
        verdict: 'true_positive' as const,
        reason: 'No LLM available for triage',
      },
    }));
  }

  logToFile(`[WARLOCK] triaging ${relevant.length} match(es) via LLM`);
  const triaged = await triageMatches(content, relevant, provider);
  const tp = triaged.filter((m) => m.triage.verdict === 'true_positive').length;
  const fp = triaged.filter(
    (m) => m.triage.verdict === 'false_positive',
  ).length;
  logToFile(
    `[WARLOCK] triage complete — ${tp} true positive(s), ${fp} false positive(s)`,
  );

  return triaged;
}

function getTruePositives(triaged: TriageMatch[]): TriageMatch[] {
  return triaged.filter((m) => m.triage.verdict === 'true_positive');
}

// ─── Scan Report Accumulator ─────────────────────────────────────

type ScanAction = 'blocked' | 'reverted' | 'warned' | 'aborted';

interface ScanReportEntry {
  rule: string;
  severity: string;
  action: ScanAction;
  phase: string;
  tool: string;
}

let scanCount = 0;
const scanViolations: ScanReportEntry[] = [];

function recordScan(): void {
  scanCount++;
}

function recordViolation(entry: ScanReportEntry): void {
  scanViolations.push(entry);
}

/** Current scan counts for UI display */
export function getScanCounts(): { scans: number; blocked: number } {
  const blocked = scanViolations.filter(
    (v) =>
      v.action === 'blocked' ||
      v.action === 'aborted' ||
      v.action === 'reverted',
  ).length;
  return { scans: scanCount, blocked };
}

/** Reset counters (for testing) */
export function resetScanReport(): void {
  scanCount = 0;
  scanViolations.length = 0;
}

/** Send scan summary to PostHog as an analytics event */
export function captureWarlockSummary(): void {
  if (scanCount === 0) return;

  const violations = scanViolations.length;
  const clean = scanCount - violations;
  logToFile(
    `[WARLOCK] session summary — ${scanCount} scans, ${violations} violation(s), ${clean} clean`,
  );
  analytics.wizardCapture('warlock session summary', {
    total_scans: scanCount,
    violations,
    clean,
    violation_details: scanViolations,
  });
}

// ─── Hook Timeouts (ms) ─────────────────────────────────────────

/** Timeout for hooks that may call LLM triage */
const HOOK_TIMEOUT_MS = 15_000;
/** Timeout for skill install hook (filesystem I/O + triage) */
const SKILL_SCAN_HOOK_TIMEOUT_MS = 30_000;

// ─── Logging ─────────────────────────────────────────────────────

function logMatch(
  phase: string,
  tool: string,
  match: TriageMatch | ScanMatch,
  action: ScanAction,
): void {
  const verdict = 'triage' in match ? match.triage.verdict : 'untriaged';
  logToFile(
    `[WARLOCK] ${phase}:${tool} [${action.toUpperCase()}] rule "${
      match.rule
    }" ` +
      `(severity: ${match.metadata.severity}, verdict: ${verdict})\n` +
      `  Description: ${match.metadata.description}`,
  );
  analytics.wizardCapture('warlock rule matched', {
    rule: match.rule,
    severity: match.metadata.severity as string,
    category: match.metadata.category as string,
    verdict,
    action,
    phase,
    tool,
  });
}

// ─── Severity helpers ────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function highestSeverity(
  matches: Array<TriageMatch | ScanMatch>,
): TriageMatch | ScanMatch {
  return matches.reduce((worst, m) =>
    (SEVERITY_RANK[m.metadata.severity as string] ?? 0) >
    (SEVERITY_RANK[worst.metadata.severity as string] ?? 0)
      ? m
      : worst,
  );
}

// ─── PreToolUse Hooks ────────────────────────────────────────────

export function createPreToolUseYaraHooks(): HookCallbackMatcher[] {
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
            const triaged = await scanAndTriage(command, 'command');
            const threats = getTruePositives(triaged);
            if (threats.length === 0) return {};

            const match = highestSeverity(threats);
            logMatch('PreToolUse', 'Bash', match, 'blocked');
            recordViolation({
              rule: match.rule,
              severity: match.metadata.severity as string,
              action: 'blocked',
              phase: 'PreToolUse',
              tool: 'Bash',
            });

            return {
              decision: 'block',
              reason: `[WARLOCK] ${match.rule}: ${match.metadata.description}. Command blocked for security.`,
            };
          } catch (error) {
            logToFile('[WARLOCK] PreToolUse hook error:', error);
            return {
              decision: 'block',
              reason:
                '[WARLOCK] Scanner error — command blocked as a precaution.',
            };
          }
        },
      ],
      timeout: HOOK_TIMEOUT_MS,
    },
  ];
}

// ─── PostToolUse Hooks ───────────────────────────────────────────

export function createPostToolUseYaraHooks(): HookCallbackMatcher[] {
  return [
    // ── Write/Edit content scanning ──
    {
      hooks: [
        async (input: HookInput): Promise<HookOutput> => {
          try {
            const toolName = input.tool_name as string;
            if (toolName !== 'Write' && toolName !== 'Edit') return {};

            const toolInput = input.tool_input as Record<string, unknown>;
            const content =
              toolName === 'Write'
                ? (toolInput?.content as string) ?? ''
                : (toolInput?.new_str as string) ?? '';
            if (!content) return {};

            recordScan();
            const triaged = await scanAndTriage(content, 'output');
            const threats = getTruePositives(triaged);
            if (threats.length === 0) return {};

            const match = highestSeverity(threats);
            logMatch('PostToolUse', toolName, match, 'reverted');
            recordViolation({
              rule: match.rule,
              severity: match.metadata.severity as string,
              action: 'reverted',
              phase: 'PostToolUse',
              tool: toolName,
            });

            return {
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext:
                  `[WARLOCK VIOLATION] ${match.rule}: ${match.metadata.description}. ` +
                  `You MUST revert this change immediately. The content you just wrote violates security policy.`,
              },
            };
          } catch (error) {
            logToFile('[WARLOCK] PostToolUse Write/Edit hook error:', error);
            return {
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext:
                  '[WARLOCK] Scanner error — you MUST revert this change as a precaution.',
              },
            };
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
            const content =
              typeof toolResponse === 'string'
                ? toolResponse
                : JSON.stringify(toolResponse ?? '');
            if (!content) return {};

            recordScan();
            const triaged = await scanAndTriage(content, 'input');
            const threats = getTruePositives(triaged);
            if (threats.length === 0) return {};

            const match = highestSeverity(threats);

            if ((match.metadata.severity as string) === 'critical') {
              logMatch('PostToolUse', toolName, match, 'aborted');
              recordViolation({
                rule: match.rule,
                severity: match.metadata.severity as string,
                action: 'aborted',
                phase: 'PostToolUse',
                tool: toolName,
              });
              return {
                stopReason:
                  `[WARLOCK CRITICAL] ${match.rule}: Prompt injection detected in file content. ` +
                  `Agent context is potentially poisoned. Session terminated for safety.`,
              };
            }

            logMatch('PostToolUse', toolName, match, 'warned');
            recordViolation({
              rule: match.rule,
              severity: match.metadata.severity as string,
              action: 'warned',
              phase: 'PostToolUse',
              tool: toolName,
            });
            return {
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext: `[WARLOCK WARNING] ${match.rule}: ${match.metadata.description}`,
              },
            };
          } catch (error) {
            logToFile('[WARLOCK] PostToolUse Read/Grep hook error:', error);
            return {
              stopReason:
                '[WARLOCK] Scanner error while scanning read content — session terminated as a precaution.',
            };
          }
        },
      ],
      timeout: HOOK_TIMEOUT_MS,
    },

    // ── Skill install scanning ──
    {
      hooks: [
        async (input: HookInput): Promise<HookOutput> => {
          try {
            const toolName = input.tool_name as string;
            if (toolName !== 'Bash') return {};

            const toolInput = input.tool_input as Record<string, unknown>;
            const command =
              typeof toolInput?.command === 'string' ? toolInput.command : '';
            if (!isSkillInstallCommand(command)) return {};

            const dirMatch = command.match(
              /mkdir -p (.claude\/skills\/[^\s&]+)/,
            );
            if (!dirMatch) return {};

            const skillDir = dirMatch[1];
            const cwd = (input.cwd as string) ?? process.cwd();
            recordScan();
            const result = await scanSkillFiles(cwd, skillDir);

            const threats = getTruePositives(result);
            if (threats.length === 0) return {};

            const match = highestSeverity(threats);
            logMatch('PostToolUse', 'Bash (skill install)', match, 'aborted');
            recordViolation({
              rule: match.rule,
              severity: match.metadata.severity as string,
              action: 'aborted',
              phase: 'PostToolUse',
              tool: 'Bash (skill)',
            });

            return {
              stopReason:
                `[WARLOCK CRITICAL] Poisoned skill detected in ${skillDir}: ${match.rule}. ` +
                `The downloaded skill contains potential prompt injection. Session terminated for safety.`,
            };
          } catch (error) {
            logToFile('[WARLOCK] PostToolUse skill install hook error:', error);
            return {
              stopReason:
                '[WARLOCK] Scanner error while scanning skill files — session terminated as a precaution.',
            };
          }
        },
      ],
      timeout: SKILL_SCAN_HOOK_TIMEOUT_MS,
    },
  ];
}

// ─── Skill File Scanner ──────────────────────────────────────────

async function scanSkillFiles(
  cwd: string,
  skillDir: string,
): Promise<TriageMatch[]> {
  const absoluteDir = path.resolve(cwd, skillDir);

  if (!fs.existsSync(absoluteDir)) {
    logToFile(`[WARLOCK] Skill directory does not exist: ${absoluteDir}`);
    return [];
  }

  const files = await fg('**/*.{md,txt,yaml,yml,json,js,ts,py,rb,sh}', {
    cwd: absoluteDir,
    absolute: true,
  });

  const allContent: string[] = [];
  const allMatches: ScanMatch[] = [];

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const result = await scan(content);
      if (result.matched) {
        const relevant = result.matches.filter(
          (m) => m.metadata.scan_context === 'input',
        );
        allMatches.push(...relevant);
        if (relevant.length > 0) allContent.push(content);
      }
    } catch (err) {
      logToFile(`[WARLOCK] Could not read skill file ${filePath}:`, err);
    }
  }

  if (allMatches.length === 0) return [];

  logToFile(
    `[WARLOCK] Scanning ${files.length} files in skill directory: ${skillDir}`,
  );

  const provider = getTriageProvider();
  if (!provider) {
    return allMatches.map((m) => ({
      ...m,
      triage: {
        verdict: 'true_positive' as const,
        reason: 'No LLM available for triage',
      },
    }));
  }

  const combinedContent = allContent.join('\n---\n');
  return triageMatches(combinedContent, allMatches, provider);
}
