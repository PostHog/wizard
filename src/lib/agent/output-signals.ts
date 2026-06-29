/**
 * Parses the signal-bearing lines out of agent output and discards the rest.
 *
 * The agent and SDK communicate non-content events (auth/API errors, missing
 * MCP/resource, the end-of-run remark) by emitting marker strings inside
 * their prose. `AgentOutputSignals` keeps only the lines that carry such a
 * marker, so the buffer stays bounded regardless of run length.
 *
 * YARA violations are deliberately NOT detected here: scanning the agent's
 * prose for "[YARA ...]" markers false-positives when the agent merely
 * *mentions* a non-terminal block. Terminal YARA outcomes flow through the
 * hooks' onTerminate callback (`yaraViolationReason` in runAgent) instead.
 */

import { AgentSignals } from './signals';

/**
 * Single source of truth for the substrings runAgent scans agent output for.
 * `push()` retains a line iff it contains one of these values; every query
 * reads the same table, so retention and consumers cannot drift. API-error
 * status codes are not separate entries — `API_ERROR` is the one needle and
 * the code is a parameter to `hasApiErrorStatus`.
 */
const OUTPUT_SIGNALS = {
  API_ERROR: 'API Error:',
  MCP_MISSING: AgentSignals.ERROR_MCP_MISSING,
  RESOURCE_MISSING: AgentSignals.ERROR_RESOURCE_MISSING,
  WIZARD_REMARK: AgentSignals.WIZARD_REMARK,
} as const;

type OutputSignal = keyof typeof OUTPUT_SIGNALS;
const SIGNAL_NEEDLES = Object.values(OUTPUT_SIGNALS);

export class AgentOutputSignals {
  private readonly lines: string[] = [];
  private apiKeySourceValue: string | undefined;

  /** Parse step: keep the line only if it carries a known signal; drop prose. */
  push(text: string): void {
    if (SIGNAL_NEEDLES.some((n) => text.includes(n))) this.lines.push(text);
  }

  /**
   * Record the SDK's `apiKeySource` from its `init` message (e.g.
   * `"/login managed key"`, `"ANTHROPIC_API_KEY"`). Used to triage a 401:
   * a managed-login source means the SDK authenticated with a stored Claude
   * login rather than the gateway token the wizard injected.
   */
  recordApiKeySource(source: string | undefined): void {
    if (source) this.apiKeySourceValue = source;
  }

  get apiKeySource(): string | undefined {
    return this.apiKeySourceValue;
  }

  /**
   * True when the SDK authed from a stored `/login` credential (the
   * "managed key") instead of an explicit `ANTHROPIC_API_KEY` — the signature
   * of conflicting Anthropic credentials behind a gateway 401.
   */
  usedManagedLogin(): boolean {
    return /login|managed key/i.test(this.apiKeySourceValue ?? '');
  }

  private get text(): string {
    return this.lines.join('\n');
  }

  /** True if any retained line contains the given signal's marker. */
  has(signal: OutputSignal): boolean {
    return this.text.includes(OUTPUT_SIGNALS[signal]);
  }

  hasApiError(): boolean {
    return this.has('API_ERROR');
  }

  /** True for a specific HTTP status, e.g. 401 (auth) or 429 (rate limit). */
  hasApiErrorStatus(code: number): boolean {
    return this.text.includes(`${OUTPUT_SIGNALS.API_ERROR} ${code}`);
  }

  /** Joined `API Error: …` lines for the user-facing message, or undefined. */
  apiErrorMessage(): string | undefined {
    const m = this.text.match(
      new RegExp(`${OUTPUT_SIGNALS.API_ERROR} [^\\n]+`, 'g'),
    );
    return m ? m.join('\n') : undefined;
  }

  /** Text after the single `[WIZARD-REMARK]` marker, trimmed, or undefined. */
  remark(): string | undefined {
    const re = new RegExp(
      `${OUTPUT_SIGNALS.WIZARD_REMARK.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      )}\\s*(.+?)(?:\\n|$)`,
      's',
    );
    return this.text.match(re)?.[1]?.trim() || undefined;
  }
}
