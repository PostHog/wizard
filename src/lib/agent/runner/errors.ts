/**
 * Shared error helpers for the runner pipeline.
 */

import type { InstallSkillResult } from '../../wizard-tools';
import { wizardAbort, WizardError } from '../../../utils/wizard-abort';

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
    }),
  });
}
