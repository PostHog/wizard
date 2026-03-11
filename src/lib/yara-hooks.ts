/**
 * YARA hook wiring for the Claude Agent SDK.
 *
 * Creates PreToolUse and PostToolUse hook callback arrays that
 * integrate the YARA scanner into the wizard's agent loop. These
 * hooks are registered in the SDK's query() options alongside the
 * existing Stop hook.
 *
 * PreToolUse hooks block dangerous commands before execution.
 * PostToolUse hooks detect violations in written code and prompt
 * injection in read content, and scan context-mill skill downloads.
 */

import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import { scan, scanSkillDirectory } from './yara-scanner';
import type { YaraMatch, ScanResult } from './yara-scanner';
import { logToFile } from '../utils/debug';
import { analytics } from '../utils/analytics';
import { isSkillInstallCommand } from './agent-interface';

// ─── Types ───────────────────────────────────────────────────────
// Using loose types to avoid tight coupling to SDK version.
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

const YARA_REPORT_PATH = '/tmp/posthog-wizard-yara-report.json';

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
    fs.writeFileSync(YARA_REPORT_PATH, JSON.stringify(report, null, 2));
  } catch (err) {
    logToFile('[YARA] Failed to write scan report:', err);
    return null;
  }
  return YARA_REPORT_PATH;
}

// ─── Hook Timeouts (ms) ─────────────────────────────────────────

/** Timeout for synchronous scan hooks (PreToolUse, PostToolUse Write/Edit/Read) */
const HOOK_TIMEOUT_MS = 5;
/** Timeout for skill install hook (involves filesystem I/O) */
const SKILL_SCAN_HOOK_TIMEOUT_MS = 30;

// ─── Logging ─────────────────────────────────────────────────────

function logYaraMatch(phase: string, tool: string, match: YaraMatch, action: ScanAction): void {
  logToFile(
    `[YARA] ${phase}:${tool} [${action.toUpperCase()}] rule "${match.rule.name}" ` +
      `(severity: ${match.rule.severity}, category: ${match.rule.category})\n` +
      `  Description: ${match.rule.description}\n` +
      `  Matched text: "${match.matchedText.substring(0, 200)}"`,
  );
  analytics.wizardCapture('yara rule matched', {
    rule: match.rule.name,
    severity: match.rule.severity,
    category: match.rule.category,
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

/** Return the highest-severity match from a list of matches. */
function highestSeverityMatch(matches: YaraMatch[]): YaraMatch {
  return matches.reduce((worst, m) =>
    (SEVERITY_RANK[m.rule.severity] ?? 0) >
    (SEVERITY_RANK[worst.rule.severity] ?? 0)
      ? m
      : worst,
  );
}

// ─── PreToolUse Hooks ────────────────────────────────────────────

/**
 * Create PreToolUse hook matchers for YARA scanning.
 * Scans Bash commands before execution for exfiltration,
 * destructive operations, and supply chain violations.
 */
export function createPreToolUseYaraHooks(): HookCallbackMatcher[] {
  return [
    {
      hooks: [
        (input: HookInput): Promise<HookOutput> => {
          try {
            const toolName = input.tool_name as string;
            if (toolName !== 'Bash') return Promise.resolve({});

            const toolInput = input.tool_input as Record<string, unknown>;
            const command =
              typeof toolInput?.command === 'string' ? toolInput.command : '';

            if (!command) return Promise.resolve({});

            recordScan();
            const result = scan(command, 'PreToolUse', 'Bash');
            if (!result.matched) return Promise.resolve({});

            const match = highestSeverityMatch(result.matches);
            logYaraMatch('PreToolUse', 'Bash', match, 'blocked');
            recordViolation({
              rule: match.rule.name,
              severity: match.rule.severity,
              action: 'blocked',
              phase: 'PreToolUse',
              tool: 'Bash',
            });

            return Promise.resolve({
              decision: 'block',
              reason: `[YARA] ${match.rule.name}: ${match.rule.description}. Command blocked for security.`,
            });
          } catch (error) {
            logToFile('[YARA] PreToolUse hook error:', error);
            // Fail closed: block the command if scanning fails
            return Promise.resolve({
              decision: 'block',
              reason: '[YARA] Scanner error — command blocked as a precaution.',
            });
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
 * 1. Write/Edit — scan written content for PII, secrets, config violations
 * 2. Read/Grep — scan read content for prompt injection
 * 3. Bash (skill install) — scan downloaded skill files for poisoned content
 */
export function createPostToolUseYaraHooks(): HookCallbackMatcher[] {
  return [
    // ── Write/Edit content scanning ──
    {
      hooks: [
        (input: HookInput): Promise<HookOutput> => {
          try {
            const toolName = input.tool_name as string;
            if (toolName !== 'Write' && toolName !== 'Edit')
              return Promise.resolve({});

            const toolInput = input.tool_input as Record<string, unknown>;
            // For Write, scan the content being written
            // For Edit, scan the new_str (replacement text)
            const content =
              toolName === 'Write'
                ? (toolInput?.content as string) ?? ''
                : (toolInput?.new_str as string) ?? '';

            if (!content) return Promise.resolve({});

            recordScan();
            const tool = toolName;
            const result = scan(content, 'PostToolUse', tool);
            if (!result.matched) return Promise.resolve({});

            const match = highestSeverityMatch(result.matches);
            logYaraMatch('PostToolUse', tool, match, 'reverted');
            recordViolation({
              rule: match.rule.name,
              severity: match.rule.severity,
              action: 'reverted',
              phase: 'PostToolUse',
              tool,
            });

            return Promise.resolve({
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext:
                  `[YARA VIOLATION] ${match.rule.name}: ${match.rule.description}. ` +
                  `You MUST revert this change immediately. The content you just wrote violates security policy.`,
              },
            });
          } catch (error) {
            logToFile('[YARA] PostToolUse Write/Edit hook error:', error);
            // Fail closed: instruct the agent to revert if scanning fails
            return Promise.resolve({
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext:
                  '[YARA] Scanner error — you MUST revert this change as a precaution.',
              },
            });
          }
        },
      ],
      timeout: HOOK_TIMEOUT_MS,
    },

    // ── Read/Grep prompt injection scanning ──
    {
      hooks: [
        (input: HookInput): Promise<HookOutput> => {
          try {
            const toolName = input.tool_name as string;
            if (toolName !== 'Read' && toolName !== 'Grep')
              return Promise.resolve({});

            const toolResponse = input.tool_response;
            const content =
              typeof toolResponse === 'string'
                ? toolResponse
                : JSON.stringify(toolResponse ?? '');

            if (!content) return Promise.resolve({});

            recordScan();
            const tool = toolName;
            const result = scan(content, 'PostToolUse', tool);
            if (!result.matched) return Promise.resolve({});

            const match = highestSeverityMatch(result.matches);

            if (match.rule.severity === 'critical') {
              logYaraMatch('PostToolUse', tool, match, 'aborted');
              recordViolation({
                rule: match.rule.name,
                severity: match.rule.severity,
                action: 'aborted',
                phase: 'PostToolUse',
                tool,
              });
              // Prompt injection: abort the session — context is poisoned
              return Promise.resolve({
                stopReason:
                  `[YARA CRITICAL] ${match.rule.name}: Prompt injection detected in file content. ` +
                  `Agent context is potentially poisoned. Session terminated for safety.`,
              });
            }

            logYaraMatch('PostToolUse', tool, match, 'warned');
            recordViolation({
              rule: match.rule.name,
              severity: match.rule.severity,
              action: 'warned',
              phase: 'PostToolUse',
              tool,
            });
            return Promise.resolve({
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext: `[YARA WARNING] ${match.rule.name}: ${match.rule.description}`,
              },
            });
          } catch (error) {
            logToFile('[YARA] PostToolUse Read/Grep hook error:', error);
            // Fail closed: terminate session if scanning fails on read content
            return Promise.resolve({
              stopReason:
                '[YARA] Scanner error while scanning read content — session terminated as a precaution.',
            });
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
            const result = await scanSkillFiles(cwd, skillDir);

            if (!result.matched) return {};

            const match = highestSeverityMatch(result.matches);
            logYaraMatch('PostToolUse', 'Bash (skill install)', match, 'aborted');
            recordViolation({
              rule: match.rule.name,
              severity: match.rule.severity,
              action: 'aborted',
              phase: 'PostToolUse',
              tool: 'Bash (skill)',
            });

            return {
              stopReason:
                `[YARA CRITICAL] Poisoned skill detected in ${skillDir}: ${match.rule.name}. ` +
                `The downloaded skill contains potential prompt injection. Session terminated for safety.`,
            };
          } catch (error) {
            logToFile('[YARA] PostToolUse skill install hook error:', error);
            // Fail closed: terminate if skill scanning fails
            return {
              stopReason:
                '[YARA] Scanner error while scanning skill files — session terminated as a precaution.',
            };
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
 */
async function scanSkillFiles(
  cwd: string,
  skillDir: string,
): Promise<ScanResult> {
  const absoluteDir = path.resolve(cwd, skillDir);

  if (!fs.existsSync(absoluteDir)) {
    logToFile(`[YARA] Skill directory does not exist: ${absoluteDir}`);
    return { matched: false };
  }

  const files = await fg('**/*.{md,txt,yaml,yml,json,js,ts,py,rb,sh}', {
    cwd: absoluteDir,
    absolute: true,
  });

  const fileContents: Array<{ path: string; content: string }> = [];
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      fileContents.push({ path: filePath, content });
    } catch (err) {
      logToFile(`[YARA] Could not read skill file ${filePath}:`, err);
    }
  }

  if (fileContents.length === 0) {
    logToFile(`[YARA] No text files found in skill directory: ${absoluteDir}`);
    return { matched: false };
  }

  logToFile(
    `[YARA] Scanning ${fileContents.length} files in skill directory: ${skillDir}`,
  );
  return scanSkillDirectory(fileContents);
}
