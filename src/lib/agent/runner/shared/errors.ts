/**
 * Shared error helpers for the runner pipeline.
 */

import type { InstallSkillResult } from '@lib/wizard-tools';
import { wizardAbort, WizardError } from '@utils/wizard-abort';
import { AgentErrorType } from '@lib/agent/agent-interface';
import { OutroKind, type WizardSession } from '@lib/wizard-session';
import type { AbortCase } from './types';

/**
 * Decide how to surface an agent `[ABORT] <reason>`. A reason matching a
 * declared AbortCase is an expected user condition and is not reported to error
 * tracking; an unrecognized abort carries a WizardError so it is.
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
  let matched: AbortCase | undefined;
  let matchResult: RegExpMatchArray | null = null;
  for (const c of config.abortCases ?? []) {
    const m = reason.match(c.match);
    if (m) {
      matched = c;
      matchResult = m;
      break;
    }
  }
  if (matched && matchResult) {
    const body =
      typeof matched.body === 'function'
        ? matched.body(matchResult)
        : matched.body;
    return {
      outroData: {
        kind: OutroKind.Error,
        message: matched.message,
        body,
        docsUrl: matched.docsUrl,
      },
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
