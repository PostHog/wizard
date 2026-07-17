/**
 * Shared error helpers for the runner pipeline.
 */

import type { InstallSkillResult } from '@lib/wizard-tools';
import { wizardAbort, WizardError } from '@utils/wizard-abort';
import { AgentErrorType } from '@lib/agent/agent-interface';
import { OutroKind, type WizardSession } from '@lib/wizard-session';
import type { AbortCase } from './types';

/**
 * Decide how to surface an agent `[ABORT] <reason>`.
 *
 * A `[ABORT]` is "distinct from errors" (see `AgentSignals.ABORT`): when the
 * reason matches a program's declared {@link AbortCase} it's an expected user
 * condition — no MCP server, an unsupported language, an unrecognizable repo —
 * and must NOT be reported to error tracking. Only unrecognized aborts, which
 * likely signal a genuine bug, carry a `WizardError` for `captureException`.
 */
export function resolveAbortOutcome(
  reason: string,
  config: {
    abortCases?: AbortCase[];
    integrationLabel: string;
    docsUrl: string;
  },
): {
  outroData: WizardSession['outroData'];
  error?: WizardError;
  matched: AbortCase | undefined;
} {
  const matched = config.abortCases?.find((c) => c.match.test(reason));
  if (matched) {
    return {
      outroData: {
        kind: OutroKind.Error,
        message: matched.message,
        body: matched.body,
        docsUrl: matched.docsUrl,
      },
      // Expected condition — render the friendly outro, but do not report it.
      error: undefined,
      matched,
    };
  }

  return {
    outroData: {
      kind: OutroKind.Error,
      message: `${config.integrationLabel} aborted`,
      body: reason || 'The agent aborted the program.',
      docsUrl: config.docsUrl,
    },
    error: new WizardError(`Agent aborted: ${reason}`, {
      integration: config.integrationLabel,
      error_type: AgentErrorType.ABORT,
      reason,
    }),
    matched,
  };
}

export async function abortOnInstallFailure(
  integrationLabel: string,
  result: InstallSkillResult,
): Promise<void> {
  if (result.kind === 'ok') return;

  const message = (() => {
    switch (result.kind) {
      case 'menu-fetch-failed':
        return 'Could not fetch the skill menu from context-mill.\nCheck your network connection and try again.';
      case 'skill-not-found':
        return `Could not find the "${result.skillId}" skill in the context-mill menu.\nPlease try again later.`;
      case 'download-failed':
        return `Failed to install skill: ${result.message}\nPlease try again.`;
    }
  })();

  await wizardAbort({
    message,
    error: new WizardError(`Skill install failed: ${result.kind}`, {
      integration: integrationLabel,
      error_type: result.kind,
      platform: process.platform,
      // The kind can't separate missing-tool from network failures.
      ...(result.kind === 'download-failed'
        ? { error_detail: result.message.slice(0, 500) }
        : {}),
    }),
  });
}
