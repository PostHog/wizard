/**
 * Self-driving prerequisite detection + abort vocabulary.
 *
 * The only precondition that can be verified before auth is local: the
 * PostHog setup report must exist, proving the base posthog-integration
 * program ran. The beta gates (the `product-autonomy` access flag and
 * `signals-scout` enrollment — PostHog-side flag names, unchanged by the
 * wizard-side "self-driving" rename) are PostHog-internal flags with no
 * customer-facing read API, so the agent probes the Signals API at the
 * start of the run instead and emits a structured `[ABORT]` when the
 * product is not available for the team.
 */

import { existsSync, statSync } from 'fs';
import { join } from 'path';
import type { WizardSession } from '@lib/wizard-session';
import type { AbortCase } from '@lib/agent/agent-runner';
import { SETUP_REPORT_FILE } from '@lib/programs/posthog-integration/index';

/**
 * Structured detection errors. The intro screen renders each kind into
 * JSX — keeps error data separate from presentation.
 */
export type SelfDrivingDetectError =
  | {
      kind: 'bad-directory';
      path: string;
      reason: 'missing' | 'not-dir' | 'unreadable';
    }
  | { kind: 'no-setup-report'; reportFile: string };

/**
 * `[ABORT] <reason>` cases the self-driving skill can emit. The
 * reason strings are part of the skill contract — the context-mill
 * `self-driving-setup` skill emits these exact strings.
 */
export const SELF_DRIVING_ABORT_CASES: AbortCase[] = [
  {
    // Skill emits: [ABORT] self-driving is not available for this project
    match: /^self-driving is not available for this project$/i,
    message: 'PostHog Self-driving is not available for this project',
    body:
      'Self-driving is in beta and is enabled per ' +
      'team by PostHog. This project does not appear to have access yet. ' +
      'Reach out to your PostHog contact (or wizard@posthog.com) to join ' +
      'the beta, then run the wizard again.',
  },
  {
    // Skill emits: [ABORT] github connection declined
    match: /^github connection declined$/i,
    message: 'GitHub connection required',
    body:
      'Self-driving needs GitHub access to research issues in your code and ' +
      'open fixes, so setup cannot finish without it. Nothing was left ' +
      'half-configured. When you are ready to install the PostHog GitHub ' +
      'App, run the wizard again.',
  },
  {
    // Skill emits: [ABORT] ai data processing approval declined
    match: /^ai data processing approval declined$/i,
    message: 'AI data processing approval required',
    body:
      'Self-driving analyzes your product data with AI, which needs an ' +
      'organization-level approval. Without it, every signal is dropped ' +
      'before it reaches your inbox. Approve AI processing under Settings ' +
      '→ Organization → AI service providers, then run the wizard again.',
  },
  {
    // Skill emits: [ABORT] requires-interactive-mode
    match: /^requires-interactive-mode$/i,
    message: 'Interactive terminal required',
    body:
      'Self-driving setup asks questions along the way (GitHub, issue ' +
      'trackers, AI approval), so it needs an interactive terminal. Run ' +
      'the wizard outside CI / non-interactive mode.',
  },
  {
    // The wizard_ask tool's own error texts (non-interactive host, ask cap
    // reached) instruct the agent to emit this reason — cover it so those
    // paths render a friendly screen instead of the generic abort outro.
    match: /^requirements-incomplete$/i,
    message: 'Setup needs your input',
    body:
      'The wizard could not collect the answers this setup needs (the ' +
      'environment was non-interactive, or the question budget ran out). ' +
      'Nothing was left half-configured. Run the wizard again in an ' +
      'interactive terminal.',
  },
];

/**
 * Verify `session.installDir` is a readable directory containing the
 * PostHog setup report. Writes a `SelfDrivingDetectError` to
 * frameworkContext on failure — the intro screen renders it and blocks.
 */
export function detectSelfDrivingPrerequisites(
  session: WizardSession,
  setFrameworkContext: (key: string, value: unknown) => void,
): void {
  const fail = (error: SelfDrivingDetectError) =>
    setFrameworkContext('detectError', error);

  const installDir = session.installDir;

  if (!existsSync(installDir)) {
    fail({ kind: 'bad-directory', path: installDir, reason: 'missing' });
    return;
  }
  try {
    if (!statSync(installDir).isDirectory()) {
      fail({ kind: 'bad-directory', path: installDir, reason: 'not-dir' });
      return;
    }
  } catch {
    fail({ kind: 'bad-directory', path: installDir, reason: 'unreadable' });
    return;
  }

  if (!existsSync(join(installDir, SETUP_REPORT_FILE))) {
    fail({ kind: 'no-setup-report', reportFile: SETUP_REPORT_FILE });
    return;
  }

  setFrameworkContext('setupReportFound', true);
}
