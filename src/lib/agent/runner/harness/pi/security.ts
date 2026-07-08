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
 * Scanning runs through @posthog/warlock via yara-hooks' `scanAndTriage` — the
 * same engine, rules, chunking, and LLM triage policy as the anthropic
 * harness. pi handlers are async (pi's ExtensionHandler accepts promises), so
 * the WASM scan awaits inline.
 *
 * This is the one fence. Subagents run their own pi session with the SAME
 * extension installed (see subagent.ts), so a child cannot escape it.
 */

import path from 'path';
import type { LLMProvider, ScanMatch } from '@posthog/warlock';
import { wizardCanUseTool } from '@lib/agent/agent-interface';
import {
  createRepeatBlockTracker,
  isWizardDocumentationPath,
  recordExternalScan,
  repeatBlockReason,
  scanAndTriage,
  type RepeatBlockTracker,
  type ScanContext,
} from '@lib/yara-hooks';
import {
  createTriageLLMProvider,
  type TriageGatewayAuth,
} from '@lib/agent/triage-provider';
import { logToFile } from '@utils/debug';

/** warlock ScanMatch → the report shape `recordExternalScan` expects. */
function toReportViolation(m: ScanMatch) {
  return {
    rule: m.rule,
    severity: m.metadata.severity ?? 'unknown',
    category: m.metadata.category ?? 'unknown',
    description: m.metadata.description ?? '',
  };
}

/** Runaway backstop: hard cap on tool calls per (sub)agent session. */
export const MAX_TOOL_CALLS = 250;

export interface ToolGateContext {
  disallowedTools?: readonly string[];
  /** True while a wizard_ask overlay is open (interactive); blocks Write/Edit. */
  getWizardAskPending?: () => boolean;
  /**
   * Gateway auth for the LLM triage pass. pi auths the gateway
   * programmatically and never sets ANTHROPIC_BASE_URL/AUTH_TOKEN on the env,
   * so without this triage silently no-ops and every flagged match is acted
   * on (fail-closed, but no false-positive filtering).
   */
  triageAuth?: TriageGatewayAuth;
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

/** True when every rm target is a plain file path we are willing to let the agent delete. */
function isDeletableProjectFile(target: string): boolean {
  const isAnotherFlag = target.startsWith('-');
  const hasGlobOrHomeChars = /[*?[\]{}~]/.test(target);
  const leavesProject =
    path.isAbsolute(target) || target.split(/[\\/]/).includes('..');
  const isEnvFile = path.basename(target).startsWith('.env');

  return !isAnotherFlag && !hasGlobOrHomeChars && !leavesProject && !isEnvFile;
}

/** Matches `rm [-f] <file...>` where every file is a bare relative path inside the project. */
function isScopedFileRemoval(command: string): boolean {
  const [executable, ...args] = command.trim().split(/\s+/);
  if (executable !== 'rm') return false;

  if (args[0] === '-f') args.shift();
  if (args.length === 0) return false;

  return args.every(isDeletableProjectFile);
}

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
 * The agent-facing block message. Includes the rule's remediation so a blocked
 * agent can self-correct (e.g. "move PII to identify()/$set") instead of
 * retrying near-identical content.
 */
function blockMessage(m: ScanMatch): string {
  const remediation = m.metadata.remediation
    ? ` Fix: ${m.metadata.remediation}.`
    : '';
  return `[YARA] ${m.rule}: ${
    m.metadata.description ?? 'security rule matched'
  }.${remediation} Blocked for security.`;
}

/**
 * YARA scan of the content a tool is about to act on, BEFORE it executes.
 * - bash → scan the command ('command'-context rules: exfiltration,
 *   destructive, force-push). No triage — a flagged command always blocks,
 *   same as the anthropic PreToolUse hook, so the LLM call would be wasted.
 * - write/edit → scan the content being written ('output'-context rules:
 *   hardcoded keys, PII), WITH triage, and with the same wizard-doc
 *   `posthog_pii` suppression the anthropic path uses so the agent's own
 *   event-plan files aren't blocked.
 * Returns a block reason, or undefined to allow. Read/grep are post-scanned on
 * their output (in the tool_result hook), not here.
 */
async function preExecutionYaraBlock(
  toolName: string,
  input: Record<string, unknown>,
  llmProvider: LLMProvider | undefined,
  repeatTracker?: RepeatBlockTracker,
): Promise<string | undefined> {
  let content: string;
  let ctx: ScanContext;
  let triage: LLMProvider | undefined;
  // Report labels for the scan report (phase/tool), matching the anthropic
  // hooks so pi and anthropic runs read the same in telemetry.
  let phase: string;
  let tool: string;
  switch (toolName) {
    case 'bash':
      content = str(input.command);
      ctx = 'command';
      triage = undefined;
      phase = 'PreToolUse';
      tool = 'Bash';
      break;
    case 'write':
      content = str(input.content);
      ctx = 'output';
      triage = llmProvider;
      phase = 'PostToolUse';
      tool = 'Write';
      break;
    case 'edit':
      // Scan ONLY the replacement text. `edits` is [{oldText, newText}] and
      // oldText is pre-existing file content the agent is changing — scanning
      // it blocks edits whose *surroundings* contain a violation, and even
      // edits that are removing one (field FPs: capture edits adjacent to
      // existing identify() PII; pre-existing violations blocking their own
      // replacement). Matches the anthropic path, which scans new_string only.
      content = (Array.isArray(input.edits) ? input.edits : [])
        .map((e) => str((e as Record<string, unknown>)?.newText))
        .join('\n');
      ctx = 'output';
      triage = llmProvider;
      phase = 'PostToolUse';
      tool = 'Edit';
      break;
    default:
      return undefined;
  }
  if (!content) return undefined;

  let matches = await scanAndTriage(content, ctx, triage);
  if (ctx === 'output' && isWizardDocumentationPath(str(input.path))) {
    matches = matches.filter((m) => m.metadata.category !== 'posthog_pii');
  }
  recordExternalScan(phase, tool, matches.map(toReportViolation), 'blocked');
  if (matches.length === 0) return undefined;

  const attempt = repeatTracker?.attempt(toolName, content) ?? 1;
  return repeatBlockReason(attempt, toolName, blockMessage(matches[0]));
}

/**
 * The pure gate decision for a single tool call. Reuses `wizardCanUseTool`
 * (deny → block) then the YARA content scan (match → block). Fail-closed: any
 * thrown error blocks.
 */
export async function evaluateToolCall(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolGateContext = {},
  llmProvider?: LLMProvider,
): Promise<GateDecision> {
  try {
    const policy = toClaudePolicyCall(toolName, input);
    const decision = wizardCanUseTool(policy.name, policy.input, {
      disallowedTools: ctx.disallowedTools,
      wizardAskPending: ctx.getWizardAskPending?.() ?? false,
    });
    // pi allows scoped rm even though the shared allowlist denies it; the YARA scan below still applies.
    const allowedOnPiAnyway =
      toolName === 'bash' && isScopedFileRemoval(str(input.command));

    if (decision.behavior === 'deny' && !allowedOnPiAnyway) {
      return { block: true, reason: decision.message };
    }

    const yaraReason = await preExecutionYaraBlock(
      toolName,
      input,
      llmProvider,
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

/** pi result tool names whose OUTPUT gets scanned for 'input'-context rules. */
function isPostScanTool(toolName: string): boolean {
  return toolName === 'read' || toolName === 'bash';
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

  // One triage provider per extension. Undefined (no gateway auth) means
  // triage is skipped and every flagged match is acted on — fail closed.
  const llmProvider = createTriageLLMProvider(ctx.triageAuth);

  // One tracker per extension = per (sub)agent session, so an identical
  // payload retried after a block gets the escalating reason.
  const gateCtx: ToolGateContext = {
    ...ctx,
    repeatTracker: ctx.repeatTracker ?? createRepeatBlockTracker(),
  };

  const factory = (pi: PiExtensionApiLike): void => {
    pi.on('tool_call', async (event) => {
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
      const decision = await evaluateToolCall(
        event.toolName,
        event.input ?? {},
        gateCtx,
        llmProvider,
      );
      if (decision.block) {
        state.blockedCount += 1;
        logToFile(`[pi-security] BLOCK ${event.toolName}: ${decision.reason}`);
        return { block: true, reason: decision.reason };
      }
      return {};
    });

    pi.on('tool_result', async (event) => {
      if (!isPostScanTool(event.toolName)) return {};
      const text = (event.content ?? [])
        .map((c) => (c && c.type === 'text' ? c.text : ''))
        .join('\n');
      if (!text) return {};
      try {
        // 'input'-context rules (prompt injection in read content), with
        // triage — same policy as the anthropic PostToolUse Read hook.
        const matches = await scanAndTriage(text, 'input', llmProvider);
        recordExternalScan(
          'PostToolUse',
          event.toolName === 'read' ? 'Read' : 'Bash',
          matches.map(toReportViolation),
          'aborted',
        );
        if (matches.length > 0) {
          state.criticalViolation = true;
          logToFile(
            `[pi-security] POST-SCAN VIOLATION ${event.toolName}: ${matches[0].rule}`,
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
 * CommonJS unit tests can load it directly). Handlers may return promises —
 * pi's real ExtensionHandler is `(event, ctx) => Promise<R | void> | R | void`.
 */
export interface PiExtensionApiLike {
  on(
    event: 'tool_call',
    handler: (event: {
      toolName: string;
      input?: Record<string, unknown>;
    }) =>
      | { block?: boolean; reason?: string }
      | Promise<{ block?: boolean; reason?: string }>,
  ): void;
  on(
    event: 'tool_result',
    handler: (event: {
      toolName: string;
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    }) => Record<string, never> | Promise<Record<string, never>>,
  ): void;
}
