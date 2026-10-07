/** The outro every run ends on: the agent, programs and the UI share this shape. */

import type { ErrorCode } from '@shared/errors';

/** Outcome kind for the outro screen */
export enum OutroKind {
  Success = 'success',
  Error = 'error',
  Cancel = 'cancel',
}

export interface OutroData {
  kind: OutroKind;
  /** Main headline (green check for Success, red X for Error, etc.) */
  message?: string;
  /** Error-only: the primary recovery instruction, above the supporting body. */
  instruction?: string;
  /** Free-form body text shown under the headline. Use \n for paragraph breaks. */
  body?: string;
  /** Success-only: bulleted list of "what the agent did" */
  changes?: string[];
  /**
   * Success-only: a prominent, labeled link to where the user should go
   * next (e.g. an inbox the program just configured). Rendered right under
   * the headline and shown verbatim — no UTM tagging — so the URL stays
   * clean and copy-pasteable. Set per-program in buildOutroData.
   */
  primaryLink?: { label: string; url: string };
  /**
   * Success-only: a short "what to do next" checklist with its own heading,
   * rendered as a bulleted list. Distinct from `changes`, which recaps what
   * the agent already did.
   */
  nextSteps?: { heading: string; items: string[] };
  docsUrl?: string;
  /** Optional label above an error's documentation link. */
  docsLabel?: string;
  continueUrl?: string;
  /** Report file the agent wrote (e.g. "posthog-setup-report.md") */
  reportFile?: string;
  /** Stable machine-readable error code from the error catalog (@shared/errors). */
  errorCode?: ErrorCode;
  /** Structured context for the error code; safe for telemetry payloads. */
  errorDetail?: Record<string, unknown>;
  /** PostHog dashboard URL the program created on the user's behalf. */
  dashboardUrl?: string;
  /** PostHog notebook URL the program uploaded the report to. */
  notebookUrl?: string;
  /**
   * Copy-paste prompt the operator hands to their coding agent to finish the
   * job (work the report's checklist). Printed to the terminal's main buffer on
   * exit (see getExitLine in start-tui.ts) — the TUI's alternate screen is wiped
   * on exit, so the scrollback line is where it survives and can be
   * triple-click-selected. Set per-program in buildOutroData.
   */
  handoffPrompt?: string;
}
