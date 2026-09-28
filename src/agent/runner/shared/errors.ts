/**
 * Shared error helpers for the runner pipeline.
 */

import type { InstallSkillResult } from '@agent/tools';
import { ErrorCodes, skillErrorCode } from '@shared/errors';
import { RunOutcome, type AgentFailure, type SequenceResult } from './types';

export const failed = (failure: AgentFailure): SequenceResult => ({
  outcome: RunOutcome.Failed,
  failure,
});

/** The failure a skill install error decides. The caller reports and exits. */
export function installFailure(
  integrationLabel: string,
  result: Exclude<InstallSkillResult, { kind: 'ok' }>,
): AgentFailure {
  const code = skillErrorCode(result) ?? ErrorCodes.InternalUnhandled;

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

  return {
    message,
    code,
    detail: {
      integration: integrationLabel,
      error_type: result.kind,
      platform: process.platform,
      ...(result.kind === 'download-failed'
        ? { error_detail: result.message.slice(0, 500) }
        : {}),
    },
  };
}
