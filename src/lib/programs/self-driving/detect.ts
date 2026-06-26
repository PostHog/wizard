/**
 * Self-driving prerequisite detection + abort vocabulary.
 *
 * The only thing worth verifying before auth is local and cheap: that
 * `session.installDir` is a real, readable directory. We deliberately do
 * NOT require the base posthog-integration report to be present — it is a
 * report many users never commit, and `requires: ['posthog-integration']`
 * is metadata, not a hard runtime gate.
 *
 * Self-driving is now in OPEN beta — available to every team — so STEP 1
 * no longer probes the Signals API as an access gate; it completes
 * instantly so the run opens with a fast first checkmark. The
 * `self-driving is not available for this project` abort below is kept
 * only as a safety net: if the Signals API genuinely can't be reached
 * during the run (a hard error that is unexpected in open beta), the skill
 * emits it and the wizard renders a friendly "try again" screen — now with
 * open-beta wording, not the old closed, per-team "join the beta" copy. The
 * PostHog-side flags (`product-autonomy`, `signals-scout`) are unchanged by
 * the wizard-side "self-driving" rename.
 */

import { existsSync, statSync } from 'fs';
import type { WizardSession } from '@lib/wizard-session';
import type { AbortCase } from '@lib/agent/agent-runner';

/**
 * Structured detection errors. The intro screen renders each kind into
 * JSX — keeps error data separate from presentation.
 */
export type SelfDrivingDetectError = {
  kind: 'bad-directory';
  path: string;
  reason: 'missing' | 'not-dir' | 'unreadable';
};

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
      'Self-driving is in open beta and available to every team, so this ' +
      'is unexpected — the PostHog Signals API could not be reached for ' +
      'this project. Nothing was changed. Try again in a moment, and if it ' +
      'keeps happening reach out to wizard@posthog.com.',
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
    // Skill emits: [ABORT] requires-interactive-mode
    match: /^requires-interactive-mode$/i,
    message: 'Interactive terminal required',
    body:
      'Self-driving setup asks questions along the way (GitHub and ' +
      'issue trackers), so it needs an interactive terminal. Run ' +
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
 * Verify `session.installDir` is a readable directory. Writes a
 * `SelfDrivingDetectError` to frameworkContext on failure — the intro
 * screen renders it and blocks.
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
}
