/**
 * YARA content scanner for the PostHog wizard.
 *
 * This file is the single source of truth for all wizard YARA rules.
 *
 * Scans tool inputs (pre-execution) and outputs (post-execution) for
 * security violations including PII leakage, hardcoded secrets,
 * prompt injection, and secret exfiltration.
 *
 * We use YARA-style regex rules rather than the real YARA C library to
 * avoid native binary dependencies in an npx-distributed npm package.
 *
 * This is Layer 2 (L2) in the wizard's defense-in-depth model,
 * complementing the prompt-based commandments (L0) and the
 * canUseTool() allowlist (L1).
 */

// ─── Types ───────────────────────────────────────────────────────

export type YaraSeverity = 'critical' | 'high' | 'medium' | 'low';

export type YaraCategory =
  | 'posthog_pii'
  | 'posthog_hardcoded_key'
  | 'posthog_autocapture'
  | 'posthog_config'
  | 'prompt_injection'
  | 'exfiltration'
  | 'filesystem_safety'
  | 'supply_chain';

export type HookPhase = 'PreToolUse' | 'PostToolUse';
export type ToolTarget = 'Bash' | 'Write' | 'Edit' | 'Read' | 'Grep';

export interface YaraRule {
  /** Rule name matching the .yar file (e.g. 'pii_in_capture_call') */
  name: string;
  description: string;
  severity: YaraSeverity;
  category: YaraCategory;
  /** Which hook+tool combinations this rule applies to */
  appliesTo: Array<{ phase: HookPhase; tool: ToolTarget }>;
  /** Compiled regex patterns — any match triggers the rule */
  patterns: RegExp[];
}

export interface YaraMatch {
  rule: YaraRule;
  /** The matched substring */
  matchedText: string;
  /** Byte offset in the scanned content */
  offset: number;
}

export type ScanResult =
  | { matched: false }
  | { matched: true; matches: YaraMatch[] };

// ─── Rule Definitions ────────────────────────────────────────────
//
// Patterns are compiled once at module load time for performance.
// Design spec: policies/yara/RULES.md

const POST_WRITE_EDIT: Array<{ phase: HookPhase; tool: ToolTarget }> = [
  { phase: 'PostToolUse', tool: 'Write' },
  { phase: 'PostToolUse', tool: 'Edit' },
];

const POST_READ_GREP: Array<{ phase: HookPhase; tool: ToolTarget }> = [
  { phase: 'PostToolUse', tool: 'Read' },
  { phase: 'PostToolUse', tool: 'Grep' },
];

const PRE_BASH: Array<{ phase: HookPhase; tool: ToolTarget }> = [
  { phase: 'PreToolUse', tool: 'Bash' },
];

// ── §1 PostHog API Violations ────────────────────────────────────

const pii_in_capture_call: YaraRule = {
  name: 'pii_in_capture_call',
  description:
    "Detects PII fields passed to posthog.capture() — violates 'NEVER send PII in capture()' commandment",
  severity: 'high',
  category: 'posthog_pii',
  appliesTo: POST_WRITE_EDIT,
  patterns: [
    // Direct PII field names in capture properties
    /\.capture\s*\([^)]{0,200}email/i,
    /\.capture\s*\([^)]{0,200}phone/i,
    /\.capture\s*\([^)]{0,200}full[_\s]?name/i,
    /\.capture\s*\([^)]{0,200}first[_\s]?name/i,
    /\.capture\s*\([^)]{0,200}last[_\s]?name/i,
    /\.capture\s*\([^)]{0,200}(street|mailing|home|billing)[_\s]?address/i,
    /\.capture\s*\([^)]{0,200}(ssn|social[_\s]?security)/i,
    /\.capture\s*\([^)]{0,200}(date[_\s]?of[_\s]?birth|dob|birthday)/i,
    /\.capture\s*\([^)]{0,200}\$ip/,
    // identify() allows email/phone/name (standard PostHog user properties),
    // but highly sensitive PII is still blocked in identify().
    /\.identify\s*\([^)]{0,200}(ssn|social[_\s]?security)/i,
    /\.identify\s*\([^)]{0,200}(card[_\s]?number|cvv|credit[_\s]?card)/i,
    /\.identify\s*\([^)]{0,200}(date[_\s]?of[_\s]?birth|dob|birthday)/i,
    /\.identify\s*\([^)]{0,200}(street|mailing|home|billing)[_\s]?address/i,
    // PII in $set properties via capture (bound to same object)
    /\$set[^}]{0,200}email/i,
    /\$set[^}]{0,200}phone/i,
  ],
};

const hardcoded_posthog_key: YaraRule = {
  name: 'hardcoded_posthog_key',
  description:
    "Detects hardcoded PostHog API keys in source — violates 'use environment variables' commandment",
  severity: 'high',
  category: 'posthog_hardcoded_key',
  appliesTo: POST_WRITE_EDIT,
  patterns: [
    // PostHog project API key (phc_ prefix, 20+ alphanumeric chars)
    /phc_[a-zA-Z0-9]{20,}/,
    // PostHog personal API key (phx_ prefix)
    /phx_[a-zA-Z0-9]{20,}/,
    // Hardcoded key assignment patterns
    /apiKey\s*[:=]\s*['"][a-zA-Z0-9_]{20,}['"]/,
    /api_key\s*[:=]\s*['"][a-zA-Z0-9_]{20,}['"]/,
    /POSTHOG_KEY\s*[:=]\s*['"][a-zA-Z0-9_]{20,}['"]/,
  ],
};

const autocapture_disabled: YaraRule = {
  name: 'autocapture_disabled',
  description:
    "Detects agent disabling autocapture — violates 'don't disable autocapture' commandment",
  severity: 'medium',
  category: 'posthog_autocapture',
  appliesTo: POST_WRITE_EDIT,
  patterns: [
    /autocapture\s*:\s*false/,
    /autocapture\s*:\s*'false'/,
    /autocapture\s*:\s*"false"/,
    /autocapture\s*=\s*False/,
    /disable_autocapture\s*[:=]\s*(true|True|1)/,
  ],
};

// ── §1b Additional PostHog config rules ──────────────────────────

const hardcoded_posthog_host: YaraRule = {
  name: 'hardcoded_posthog_host',
  description:
    'Detects hardcoded PostHog host URLs in source — should use environment variables',
  severity: 'high',
  category: 'posthog_hardcoded_key',
  appliesTo: POST_WRITE_EDIT,
  patterns: [/['"]https:\/\/(us|eu)\.i\.posthog\.com['"]/],
};

const session_recording_disabled: YaraRule = {
  name: 'session_recording_disabled',
  description: 'Detects agent disabling session recording',
  severity: 'medium',
  category: 'posthog_config',
  appliesTo: POST_WRITE_EDIT,
  patterns: [
    /disable_session_recording\s*:\s*true/i,
    /disable_session_recording\s*=\s*True/,
  ],
};

const opt_out_capturing: YaraRule = {
  name: 'opt_out_capturing',
  description: 'Detects agent opting out of PostHog capturing entirely',
  severity: 'medium',
  category: 'posthog_config',
  appliesTo: POST_WRITE_EDIT,
  patterns: [
    // Match opt_out_capturing as a config property (in init options), not as a method call.
    // posthog.opt_out_capturing() is a legitimate GDPR-required API.
    /opt_out_capturing\s*[:=]\s*(true|True|1)/i,
    /opted_out\s*[:=]\s*(true|True|1)/i,
  ],
};

// ── §2 Prompt Injection ──────────────────────────────────────────

const prompt_injection_wizard_override: YaraRule = {
  name: 'prompt_injection_wizard_override',
  description:
    'Detects classic prompt injection attempting to override agent instructions',
  severity: 'critical',
  category: 'prompt_injection',
  appliesTo: POST_READ_GREP,
  patterns: [
    // Direct instruction override — classic injection patterns
    /ignore previous instructions/i,
    /disregard all/i,
    /forget your instructions/i,
    /override your rules/i,
    // Role manipulation
    /act as a different/i,
    /new instructions:/i,
  ],
};

const prompt_injection_wizard_specific: YaraRule = {
  name: 'prompt_injection_wizard_specific',
  description:
    'Detects wizard-specific manipulation or tool abuse attempts in project files',
  severity: 'medium',
  category: 'prompt_injection',
  appliesTo: POST_READ_GREP,
  patterns: [
    // Wizard-specific manipulation
    /skip posthog/i,
    /do not install posthog/i,
    /remove posthog/i,
    /uninstall posthog/i,
    /delete the posthog/i,
    // Tool abuse via file content
    /run the following command/i,
    /execute this shell command/i,
    // Role hijacking — require "you are now a" to avoid false positives
    // on legitimate phrases like "you are now ready to..."
    /you are now a\s/i,
  ],
};

const prompt_injection_base64: YaraRule = {
  name: 'prompt_injection_base64',
  description:
    'Detects suspicious base64-encoded blocks in file content that may contain obfuscated prompt injection',
  severity: 'critical',
  category: 'prompt_injection',
  appliesTo: POST_READ_GREP,
  patterns: [
    // Long base64 strings (100+ chars) in comments or string literals
    // that aren't typical data URIs or legitimate base64 content
    /(?:\/\/|#|\/\*)\s*[A-Za-z0-9+/]{100,}={0,2}/,
  ],
};

// ── §3 Secret Exfiltration ───────────────────────────────────────

const secret_exfiltration_via_command: YaraRule = {
  name: 'secret_exfiltration_via_command',
  description:
    'Detects shell commands attempting to exfiltrate secrets or credentials',
  severity: 'critical',
  category: 'exfiltration',
  appliesTo: PRE_BASH,
  patterns: [
    // curl/wget with environment variable secrets
    /curl\s+.*\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i,
    /wget\s+.*\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i,
    // Piping sensitive content to network tools
    /(\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD)|\.env|credentials)\S*.*\|\s*curl/i,
    /(\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD)|\.env|credentials)\S*.*\|\s*wget/i,
    /\|\s*nc\s/,
    /\|\s*netcat\s/,
    // Base64 encoding piped to network
    /base64.*\|\s*(curl|wget|nc\s)/i,
    // Reading .env and sending
    /cat\s+.*\.env.*\|\s*(curl|wget)/,
    // PostHog key exfiltration specifically
    /curl.*phc_[a-zA-Z0-9]/,
    /wget.*phc_[a-zA-Z0-9]/,
  ],
};

// ── §4 Filesystem Safety ─────────────────────────────────────────

const destructive_rm: YaraRule = {
  name: 'destructive_rm',
  description: 'Detects rm -rf or rm -r commands that could mass-delete files',
  severity: 'critical',
  category: 'filesystem_safety',
  appliesTo: PRE_BASH,
  patterns: [
    // Combined flags: rm -rf, rm -fr, rm -rfi, etc.
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/,
    // Separated flags: rm -r -f, rm -f -r (with optional other flags)
    /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*r[a-zA-Z]*\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*f\b/,
    /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*f[a-zA-Z]*\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*r\b/,
  ],
};

const git_force_push: YaraRule = {
  name: 'git_force_push',
  description: 'Detects git push --force which can overwrite remote history',
  severity: 'critical',
  category: 'filesystem_safety',
  appliesTo: PRE_BASH,
  patterns: [/git\s+push\s+.*--force/, /git\s+push\s+.*-f\b/],
};

const git_reset_hard: YaraRule = {
  name: 'git_reset_hard',
  description:
    'Detects git reset --hard which discards all uncommitted changes',
  severity: 'critical',
  category: 'filesystem_safety',
  appliesTo: PRE_BASH,
  patterns: [/git\s+reset\s+--hard/],
};

// ── §5 Supply Chain ──────────────────────────────────────────────

const wrong_posthog_package: YaraRule = {
  name: 'wrong_posthog_package',
  description:
    'Detects installing the wrong PostHog npm package — should be posthog-js or posthog-node',
  severity: 'high',
  category: 'supply_chain',
  appliesTo: PRE_BASH,
  patterns: [
    // Match "npm install posthog" but not "posthog-js", "posthog-node", etc.
    /npm\s+install\s+(?:--save\s+|--save-dev\s+|-[SD]\s+)*posthog(?!\s*-)/,
    /pnpm\s+(?:add|install)\s+(?:--save\s+|--save-dev\s+|-[SD]\s+)*posthog(?!\s*-)/,
    /yarn\s+add\s+(?:--dev\s+|-D\s+)*posthog(?!\s*-)/,
    /bun\s+(?:add|install)\s+(?:--dev\s+|-[dD]\s+)*posthog(?!\s*-)/,
  ],
};

const npm_install_global: YaraRule = {
  name: 'npm_install_global',
  description:
    'Detects global npm installs — should never install packages globally',
  severity: 'high',
  category: 'supply_chain',
  appliesTo: PRE_BASH,
  patterns: [/npm\s+install\s+-g\b/, /npm\s+install\s+--global\b/],
};

// ─── Rule Registry ───────────────────────────────────────────────

export const RULES: YaraRule[] = [
  // §1 PostHog API violations
  pii_in_capture_call,
  hardcoded_posthog_key,
  autocapture_disabled,
  hardcoded_posthog_host,
  session_recording_disabled,
  opt_out_capturing,
  // §2 Prompt injection
  prompt_injection_wizard_override,
  prompt_injection_wizard_specific,
  prompt_injection_base64,
  // §3 Secret exfiltration
  secret_exfiltration_via_command,
  // §4 Filesystem safety
  destructive_rm,
  git_force_push,
  git_reset_hard,
  // §5 Supply chain
  wrong_posthog_package,
  npm_install_global,
];

// ─── Scan Engine ─────────────────────────────────────────────────

/** Maximum content length to scan (100 KB). Inputs beyond this are truncated. */
const MAX_SCAN_LENGTH = 100_000;

/**
 * Scan content against rules applicable to a given hook phase and tool.
 * Returns all matching rules (one match per rule, first pattern wins).
 */
export function scan(
  content: string,
  phase: HookPhase,
  tool: ToolTarget,
): ScanResult {
  // Cap input length to prevent pathological regex performance
  const scanContent =
    content.length > MAX_SCAN_LENGTH
      ? content.slice(0, MAX_SCAN_LENGTH)
      : content;
  const applicableRules = RULES.filter((r) =>
    r.appliesTo.some((a) => a.phase === phase && a.tool === tool),
  );

  const matches: YaraMatch[] = [];
  for (const rule of applicableRules) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(scanContent);
      if (match) {
        matches.push({
          rule,
          matchedText: match[0],
          offset: match.index,
        });
        break; // One match per rule is sufficient
      }
    }
  }

  return matches.length > 0 ? { matched: true, matches } : { matched: false };
}

/**
 * Scan all files in a skill directory for prompt injection.
 * Used for context-mill scanning after skill installation.
 */
export function scanSkillDirectory(
  files: Array<{ path: string; content: string }>,
): ScanResult {
  const allMatches: YaraMatch[] = [];
  for (const file of files) {
    const result = scan(file.content, 'PostToolUse', 'Read');
    if (result.matched) {
      allMatches.push(...result.matches);
    }
  }
  return allMatches.length > 0
    ? { matched: true, matches: allMatches }
    : { matched: false };
}
