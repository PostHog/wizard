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
import { WIZARD_INTERACTION_EVENT_NAME } from './constants';
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

// ─── Logging ─────────────────────────────────────────────────────

function logYaraMatch(phase: string, tool: string, match: YaraMatch): void {
  logToFile(
    `[YARA] ${phase}:${tool} matched rule "${match.rule.name}" ` +
      `(severity: ${match.rule.severity}, category: ${match.rule.category}): ` +
      `"${match.matchedText.substring(0, 100)}"`,
  );
  analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
    action: 'yara rule matched',
    rule: match.rule.name,
    severity: match.rule.severity,
    category: match.rule.category,
    phase,
    tool,
  });
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

            const result = scan(command, 'PreToolUse', 'Bash');
            if (!result.matched) return Promise.resolve({});

            const match = result.matches[0];
            logYaraMatch('PreToolUse', 'Bash', match);

            return Promise.resolve({
              decision: 'block',
              reason: `[YARA] ${match.rule.name}: ${match.rule.description}. Command blocked for security.`,
            });
          } catch (error) {
            logToFile('[YARA] PreToolUse hook error:', error);
            return Promise.resolve({});
          }
        },
      ],
      timeout: 5,
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

            const tool = toolName;
            const result = scan(content, 'PostToolUse', tool);
            if (!result.matched) return Promise.resolve({});

            const match = result.matches[0];
            logYaraMatch('PostToolUse', tool, match);

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
            return Promise.resolve({});
          }
        },
      ],
      timeout: 5,
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

            const tool = toolName;
            const result = scan(content, 'PostToolUse', tool);
            if (!result.matched) return Promise.resolve({});

            const match = result.matches[0];
            logYaraMatch('PostToolUse', tool, match);

            if (match.rule.severity === 'critical') {
              // Prompt injection: abort the session — context is poisoned
              return Promise.resolve({
                stopReason:
                  `[YARA CRITICAL] ${match.rule.name}: Prompt injection detected in file content. ` +
                  `Agent context is potentially poisoned. Session terminated for safety.`,
              });
            }

            return Promise.resolve({
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext: `[YARA WARNING] ${match.rule.name}: ${match.rule.description}`,
              },
            });
          } catch (error) {
            logToFile('[YARA] PostToolUse Read/Grep hook error:', error);
            return Promise.resolve({});
          }
        },
      ],
      timeout: 5,
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
            const result = await scanSkillFiles(cwd, skillDir);

            if (!result.matched) return {};

            const match = result.matches[0];
            logYaraMatch('PostToolUse', 'Bash (skill install)', match);

            return {
              stopReason:
                `[YARA CRITICAL] Poisoned skill detected in ${skillDir}: ${match.rule.name}. ` +
                `The downloaded skill contains potential prompt injection. Session terminated for safety.`,
            };
          } catch (error) {
            logToFile('[YARA] PostToolUse skill install hook error:', error);
            return {};
          }
        },
      ],
      timeout: 30,
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
    } catch {
      // Skip unreadable files
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
