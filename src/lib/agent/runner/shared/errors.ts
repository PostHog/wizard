/**
 * Shared error helpers for the runner pipeline.
 */

import type { InstallSkillResult } from '@lib/wizard-tools';
import { wizardAbort, WizardError } from '@utils/wizard-abort';

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
