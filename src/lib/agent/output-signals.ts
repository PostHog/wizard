/**
 * Parses the signal-bearing lines out of agent output and discards the rest.
 *
 * The agent and SDK communicate non-content events (auth/API errors, YARA
 * violations, missing MCP/resource, the end-of-run remark) by emitting marker
 * strings inside their prose. `AgentOutputSignals` keeps only the lines that
 * carry such a marker, so the buffer stays bounded regardless of run length.
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
  YARA_CRITICAL: '[YARA CRITICAL]',
  YARA_SCANNER_ERROR: '[YARA] Scanner error',
  MCP_MISSING: AgentSignals.ERROR_MCP_MISSING,
  RESOURCE_MISSING: AgentSignals.ERROR_RESOURCE_MISSING,
  WIZARD_REMARK: AgentSignals.WIZARD_REMARK,
} as const;

type OutputSignal = keyof typeof OUTPUT_SIGNALS;
const SIGNAL_NEEDLES = Object.values(OUTPUT_SIGNALS);

export class AgentOutputSignals {
  private readonly lines: string[] = [];

  /** Parse step: keep the line only if it carries a known signal; drop prose. */
  push(text: string): void {
    if (SIGNAL_NEEDLES.some((n) => text.includes(n))) this.lines.push(text);
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

  /**
   * True for a transient provisioning/billing 403 from the gateway's Bedrock
   * fallback: a PostHog-side AWS Marketplace condition (`INVALID_PAYMENT_INSTRUMENT`)
   * that clears on its own, whose own message advises retrying after ~2 minutes.
   * Distinct from a generic API error so the runner can retry instead of aborting
   * with the terminal "report this" message.
   */
  hasProvisioningError(): boolean {
    if (!this.hasApiErrorStatus(403)) return false;
    return (
      this.text.includes('INVALID_PAYMENT_INSTRUMENT') ||
      this.text.includes('AWS Marketplace')
    );
  }

  hasYaraViolation(): boolean {
    return this.has('YARA_CRITICAL') || this.has('YARA_SCANNER_ERROR');
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
