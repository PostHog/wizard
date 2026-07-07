/**
 * Fail-closed security for the pi backend (#525). pi has no built-in
 * permission layer, so we attach an extension that intercepts every tool call
 * — built-in (bash/read/edit/write/grep) AND custom — through pi's `tool_call`
 * hook and reuses the EXACT anthropic policy: `wizardCanUseTool` (the bash
 * allowlist + .env fencing) plus the YARA pre-scan. A `tool_result` hook
 * post-scans output. Both fail closed: a scanner error blocks, and a critical
 * post-scan violation latches so every subsequent tool call is blocked and the
 * run terminates as a YARA violation.
 *
 * This is the one fence. Subagents run their own pi session with the SAME
 * extension installed (see subagent.ts), so a child cannot escape it.
 */

import { wizardCanUseTool } from '@lib/agent/agent-interface';
import {
  scan,
  type HookPhase,
  type ToolTarget,
  type YaraMatch,
} from '@lib/yara-scanner';
import {
  createRepeatBlockTracker,
  isWizardDocumentationPath,
  recordExternalScan,
  repeatBlockReason,
  type RepeatBlockTracker,
} from '@lib/yara-hooks';
import { logToFile } from '@utils/debug';

/** yara-scanner match → the report shape `recordExternalScan` expects. */
function toReportViolation(m: YaraMatch) {
  return {
    rule: m.rule.name,
    severity: m.rule.severity,
    category: m.rule.category,
    description: m.rule.description,
  };
}

/** Runaway backstop: hard cap on tool calls per (sub)agent session. */
export const MAX_TOOL_CALLS = 250;

export interface ToolGateContext {
  disallowedTools?: readonly string[];
  /** True while a wizard_ask overlay is open (interactive); blocks Write/Edit. */
  getWizardAskPending?: () => boolean;
  /**
   * Per-run tracker of YARA-blocked payloads. When the agent retries content
   * that was already blocked, the block reason escalates ("change the code,
   * not the retry" → "report it and move on"). The extension wires one in;
   * absent (tests calling `evaluateToolCall` directly) every block reads as
   * a first attempt.
   */
  repeatTracker?: RepeatBlockTracker;
}

export interface GateDecision {
  block: boolean;
  reason?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Translate a pi tool name to the claude-cased name + input the shared policy
 * expects. pi field names (from the live tool stream): bash{command},
 * read/edit/write{path}, write adds {content}, edit adds {edits}, grep{path}.
 */
function toClaudePolicyCall(
  toolName: string,
  input: Record<string, unknown>,
): { name: string; input: Record<string, unknown> } {
  switch (toolName) {
    case 'bash':
      return { name: 'Bash', input: { command: str(input.command) } };
    case 'read':
      return { name: 'Read', input: { file_path: input.path } };
    case 'write':
      return { name: 'Write', input: { file_path: input.path } };
    case 'edit':
      return { name: 'Edit', input: { file_path: input.path } };
    case 'grep':
      return { name: 'Grep', input: { path: input.path } };
    default:
      // Custom tools (load_skill_menu, set_env_values, dispatch_agent, …) +
      // find/ls: no path/command, policy allows (their own handlers are fenced).
      return { name: toolName, input };
  }
}

/**
 * YARA scan of the content a tool is about to act on, BEFORE it executes.
 * - bash → scan the command (PreToolUse/Bash: exfiltration, destructive, force-push)
 * - write/edit → scan the content being written (PostToolUse/Write|Edit:
 *   hardcoded keys, PII), with the same wizard-doc `posthog_pii` suppression the
 *   anthropic path uses so the agent's own event-plan files aren't blocked.
 * Returns a block reason, or undefined to allow. Read/grep are post-scanned on
 * their output (in the tool_result hook), not here.
 */
function preExecutionYaraBlock(
  toolName: string,
  input: Record<string, unknown>,
  repeatTracker?: RepeatBlockTracker,
): string | undefined {
  let content: string;
  let target: ToolTarget;
  let phase: HookPhase;
  switch (toolName) {
    case 'bash':
      content = str(input.command);
      target = 'Bash';
      phase = 'PreToolUse';
      break;
    case 'write':
      content = str(input.content);
      target = 'Write';
      phase = 'PostToolUse';
      break;
    case 'edit':
      content = JSON.stringify(input.edits ?? '');
      target = 'Edit';
      phase = 'PostToolUse';
      break;
    default:
      return undefined;
  }
  if (!content) return undefined;

  const result = scan(content, phase, target);
  let matches = result.matched ? result.matches : [];
  if (
    (target === 'Write' || target === 'Edit') &&
    isWizardDocumentationPath(str(input.path))
  ) {
    matches = matches.filter((m) => m.rule.category !== 'posthog_pii');
  }
  recordExternalScan(phase, target, matches.map(toReportViolation), 'blocked');
  if (matches.length === 0) return undefined;

  const m = matches[0];
  const reason = `[YARA] ${m.rule.name}: ${m.rule.description}. Blocked for security.`;
  const attempt = repeatTracker?.attempt(target, content) ?? 1;
  return repeatBlockReason(attempt, target, reason);
}

/**
 * The pure gate decision for a single tool call. Reuses `wizardCanUseTool`
 * (deny → block) then the YARA content scan (match → block). Fail-closed: any
 * thrown error blocks.
 */
export function evaluateToolCall(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolGateContext = {},
): GateDecision {
  try {
    const policy = toClaudePolicyCall(toolName, input);
    const decision = wizardCanUseTool(policy.name, policy.input, {
      disallowedTools: ctx.disallowedTools,
      wizardAskPending: ctx.getWizardAskPending?.() ?? false,
    });
    if (decision.behavior === 'deny') {
      return { block: true, reason: decision.message };
    }

    const yaraReason = preExecutionYaraBlock(
      toolName,
      input,
      ctx.repeatTracker,
    );
    if (yaraReason) return { block: true, reason: yaraReason };

    return { block: false };
  } catch (err) {
    logToFile('[pi-security] gate error — failing closed:', err);
    return {
      block: true,
      reason: 'Security check failed; tool blocked (fail-closed).',
    };
  }
}

/** pi result tool name → YARA target for the post-scan (skip the rest). */
function postScanTarget(toolName: string): ToolTarget | undefined {
  switch (toolName) {
    case 'read':
      return 'Read';
    case 'bash':
      return 'Bash';
    default:
      return undefined;
  }
}

/** Mutable state the backend reads after the run to classify the outcome. */
export interface SecurityState {
  criticalViolation: boolean;
  blockedCount: number;
  toolCalls: number;
}

/**
 * Build the pi security extension + the shared state the backend inspects.
 * Install the returned factory via `extensionFactories`; pass the same factory
 * into every subagent session so the fence is inherited.
 */
export function createSecurityExtension(ctx: ToolGateContext = {}): {
  factory: (pi: PiExtensionApiLike) => void;
  state: SecurityState;
} {
  const state: SecurityState = {
    criticalViolation: false,
    blockedCount: 0,
    toolCalls: 0,
  };

  // One tracker per extension = per (sub)agent session, so an identical
  // payload retried after a block gets the escalating reason.
  const gateCtx: ToolGateContext = {
    ...ctx,
    repeatTracker: ctx.repeatTracker ?? createRepeatBlockTracker(),
  };

  const factory = (pi: PiExtensionApiLike): void => {
    pi.on('tool_call', (event) => {
      // A latched post-scan violation blocks everything that follows.
      if (state.criticalViolation) {
        return {
          block: true,
          reason: 'Run terminated by a security violation.',
        };
      }
      state.toolCalls += 1;
      if (state.toolCalls > MAX_TOOL_CALLS) {
        return {
          block: true,
          reason: `Stopped: exceeded ${MAX_TOOL_CALLS} tool calls (runaway guard).`,
        };
      }
      const decision = evaluateToolCall(
        event.toolName,
        event.input ?? {},
        gateCtx,
      );
      if (decision.block) {
        state.blockedCount += 1;
        logToFile(`[pi-security] BLOCK ${event.toolName}: ${decision.reason}`);
        return { block: true, reason: decision.reason };
      }
      return {};
    });

    pi.on('tool_result', (event) => {
      const target = postScanTarget(event.toolName);
      if (!target) return {};
      const text = (event.content ?? [])
        .map((c) => (c && c.type === 'text' ? c.text : ''))
        .join('\n');
      if (!text) return {};
      try {
        const result = scan(text, 'PostToolUse', target);
        const matches = result.matched ? result.matches : [];
        recordExternalScan(
          'PostToolUse',
          target,
          matches.map(toReportViolation),
          'aborted',
        );
        if (matches.length > 0) {
          state.criticalViolation = true;
          logToFile(
            `[pi-security] POST-SCAN VIOLATION ${event.toolName}: ${matches[0].rule.name}`,
          );
        }
      } catch (err) {
        // Fail closed: a scanner error on output latches a violation.
        state.criticalViolation = true;
        logToFile('[pi-security] post-scan error — failing closed:', err);
      }
      return {};
    });
  };

  return { factory, state };
}

/**
 * Minimal structural type for pi's ExtensionAPI — just the `on` overloads we
 * use. Kept local so this module has no value import from the pi SDK (so the
 * CommonJS unit tests can load it directly).
 */
export interface PiExtensionApiLike {
  on(
    event: 'tool_call',
    handler: (event: { toolName: string; input?: Record<string, unknown> }) => {
      block?: boolean;
      reason?: string;
    },
  ): void;
  on(
    event: 'tool_result',
    handler: (event: {
      toolName: string;
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    }) => Record<string, never>,
  ): void;
}
